import * as vscode from "vscode";
import * as fs from "fs";
import { createDebouncer, Debouncer } from "./debounce";
import { canBeEUCJP, isEUCJPConfirmed, needsBytesToDecideEUCJP } from "./eucjp";

export const WAVEDASH_CODE_POINT = 0x301c;
export const FULLWIDTH_TILDE_CODE_POINT = 0xff5e;
export const NUMERO_SIGN_CODE_POINT = 0x2116;

// countSpecificCharactersでString#indexOfを使うため、事前に1文字の文字列へ変換しておく
// (いずれもサロゲートペアにならないコードポイント)
//
// WAVE_DASH_CHAR(U+301C)はEUC-JPのファイルでは出現しない(VS CodeのEUC-JPコーデックは
// 波ダッシュ0xA1 0xC1も全角チルダ0x8F 0xA2 0xB7も等しくU+FF5Eにデコードし、逆に
// U+301Cはエンコードできず'?'になるため。issue #635。前提はeucjp-encoding-invariants.test.ts
// で固定してある)。ただしステータスバーのカウントはエンコーディングを問わず動くため、
// UTF-8のファイルではU+301Cが実際にカウントされる。この項を削除すると表示が変わるため残す
const WAVE_DASH_CHAR = String.fromCodePoint(WAVEDASH_CODE_POINT);
const FULLWIDTH_TILDE_CHAR = String.fromCodePoint(FULLWIDTH_TILDE_CODE_POINT);
const NUMERO_SIGN_CHAR = String.fromCodePoint(NUMERO_SIGN_CODE_POINT);

/**
 * 変換対象の一覧
 *
 * 「何を変換するか」の唯一の定義。Unicode文字での判定
 * (containsConvertTargetCharacters)とバイト列での変換
 * (replaceSpecificCharactersInBuffer)の両方をこのテーブルから駆動するため、
 * 増やすときはここに1エントリ追加するだけでよい
 *
 * 各エントリの制約(replaceSpecificCharactersInBufferの実装が依存している):
 * - fromはEUC-JPのSS3バイト(0x8F)で始まる(SS3の位置だけをindexOfで走査するため)
 * - to.length <= from.length(出力用Bufferを入力と同じ長さで確保するため)
 */
export const CONVERT_TARGETS = [
  {
    char: FULLWIDTH_TILDE_CHAR,
    configKey: "fullwidthTildeToWaveDash",
    from: [0x8f, 0xa2, 0xb7],
    to: [0xa1, 0xc1],
  },
  {
    char: NUMERO_SIGN_CHAR,
    configKey: "numeroSignToNumeroSign",
    from: [0x8f, 0xa2, 0xf1], // 全角NO(表示は同じだが下のtoとは異なるバイト列)
    to: [0xad, 0xe2], // 全角NO
  },
] as const;

type ConvertTarget = (typeof CONVERT_TARGETS)[number];

// ステータスバー更新のデバウンス時間(ms)。キーストロークのたびに全文スキャンが
// 走らないよう、この時間内の連続更新要求を1回にまとめる
const STATUS_BAR_UPDATE_DEBOUNCE_MS = 200;

// 保存後の変換を実行するまでのデバウンス時間(ms)。
//
// 保存の合間に拡張機能がファイルを書き換えると、VS Codeが記録しているファイル状態
// (etag)とディスクがズレて次の保存が「上書きに失敗しました」になる(issue #13)。
// これを避けるため、Ctrl+S長押しなどで保存イベントが連続する間は書き換えず、
// 保存が落ち着いてから1回だけ変換する
//
// 300msという値自体に実測データに基づく厳密な根拠はない。「OSのキーリピートに
// よる連打(間隔は数十ms程度)よりは確実に長く、人が意図して次の保存操作をする
// までの間隔よりは短い」という経験則で選んだ暫定値で、この不等式さえ満たせば
// 正しさは変わらない
export const SAVE_CONVERSION_DEBOUNCE_MS = 300;

let statusBarItem: vscode.StatusBarItem;

// setupStatusBarItemによる再代入後も正しいstatusBarItemを使うように、
// 値ではなく変数を捕捉するクロージャにする
const statusBarUpdateDebouncer = createDebouncer(() => {
  updateStatusBarItem(statusBarItem);
}, STATUS_BAR_UPDATE_DEBOUNCE_MS);

// 保存済みで変換待ちのドキュメント(キー: ドキュメントのURI文字列)。
// postponed: trueは「dirtyだった、またはアクティブエディタでなかったため
// 先送りした」状態で、次の保存・アクティブ化・クローズ・deactivateのいずれかで
// 変換される(判定はrunScheduledConversionを参照)
const pendingConversions = new Map<
  string,
  {
    document: vscode.TextDocument;
    postponed: boolean;
  }
>();

// 保存後変換のデバウンサ(キー: ドキュメントのURI文字列)
const saveConversionDebouncers = new Map<string, Debouncer>();

export function activate(context: vscode.ExtensionContext) {
  setupStatusBarItem();

  context.subscriptions.push(
    vscode.Disposable.from(
      vscode.commands.registerCommand(
        "waveDashUnify.enableConvert",
        async () => {
          await vscode.workspace
            .getConfiguration("waveDashUnify")
            .update("enableConvert", true, true);

          updateStatusBarItem(statusBarItem);
        },
      ),
      vscode.commands.registerCommand(
        "waveDashUnify.disableConvert",
        async () => {
          await vscode.workspace
            .getConfiguration("waveDashUnify")
            .update("enableConvert", false, true);

          updateStatusBarItem(statusBarItem);
        },
      ),
      // ファイルを保存した時に、EUC-JPのファイルの全角チルダを波ダッシュに変換する
      vscode.workspace.onDidSaveTextDocument((document) => {
        scheduleSaveConversion(document);
      }),
      // 変換待ちのままドキュメントが破棄された場合は、その場で変換する
      // (モデルが存在しなくなるためetagの不整合が起きない)
      vscode.workspace.onDidCloseTextDocument((document) => {
        flushPendingConversion(document.uri.toString());
      }),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        // エディタが切り替わったので、直前のエディタ向けにスケジュールされていた更新は不要
        statusBarUpdateDebouncer.cancel();
        updateStatusBarItem(statusBarItem);

        // 非アクティブだったために先送りされていた変換があれば、
        // アクティブになったこのタイミングで再開する(runScheduledConversionの3を参照)
        resumePendingConversionIfActive(editor?.document);
      }),
      vscode.workspace.onDidChangeTextDocument((e) => {
        // アクティブエディタ以外のドキュメント変更(出力チャンネルなど)では
        // ステータスバーの表示に影響がないため、更新をスキップする
        if (e.document !== vscode.window.activeTextEditor?.document) {
          return;
        }

        statusBarUpdateDebouncer.schedule();
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration("waveDashUnify")) {
          return;
        }

        updateStatusBarItem(statusBarItem);
      }),

      vscode.commands.registerCommand(
        "waveDashUnify.SelectEnableOrDisable",
        () => {
          const quickPick = vscode.window.createQuickPick();
          quickPick.items = [
            {
              label: "Enable convert",
              description: "Enable convert",
            },
            {
              label: "Disable convert",
              description: "Disable convert",
            },
          ];

          quickPick.onDidChangeSelection((selection) => {
            if (selection.length === 0) {
              return;
            }

            const selectedItem = selection[0];

            if (selectedItem === undefined) {
              return;
            }

            if (selectedItem.label === "Enable convert") {
              vscode.commands.executeCommand("waveDashUnify.enableConvert");
            } else if (selectedItem.label === "Disable convert") {
              vscode.commands.executeCommand("waveDashUnify.disableConvert");
            }

            quickPick.hide();
          });

          quickPick.onDidHide(() => {
            quickPick.dispose();
          });

          quickPick.show();
        },
      ),
    ),
  );
}

/**
 * 与えられた文字列中の特定文字を文字化けしないように変換する
 *
 * 置き換える文字は以下
 * | 置き換え前                  | 置き換え後             |
 * | --------------------------- | ---------------------- |
 * | 全角チルダ (0x8F 0xA2 0xB7) | 波ダッシュ (0xA1 0xC1) |
 * | 全角NO     (0x8F 0xA2 0xF1) | 全角NO     (0xAD 0xE2) |
 * @param document 変換対象のドキュメント
 * @returns `true`: ファイルを書き換えた, `false`: 書き換え不要だった
 */
export function replaceSpecificCharacters(
  document: vscode.TextDocument,
): boolean {
  if (!isConvertEnabled()) {
    return false;
  }

  // ここではまだ「確実にEUC-JPではない」ものを落とすだけ。
  // 確定判定はディスクを読んだ後(convertSavedFile)で行う
  if (!canBeEUCJP(document)) {
    return false;
  }

  // 変換対象文字がドキュメントに1つもなければディスクを読む必要すらない。安全な理由は
  // 「保存直後のテキストが真実源だから」ではなく、EUC-JPで0x8F 0xA2 0xB7(全角チルダ)を
  // 生成できる文字がU+FF5E以外に無く、0x8F 0xA2 0xF1(全角NO)もU+2116以外に無いため
  // (変換後のバイト列0xA1 0xC1 / 0xAD 0xE2もデコードすればU+FF5E / U+2116に戻るので、
  // 既に変換済みのファイルも取りこぼさない)
  if (!containsConvertTargetCharacters(document)) {
    return false;
  }

  return convertSavedFile(document);
}

/**
 * ディスク上のファイルを読み込み、変換対象のバイト列があれば書き換える
 *
 * ドキュメントのテキストを参照しないため、エディタ上の未保存の編集内容に
 * かかわらず「最後に保存された内容」を基準に変換できる
 *
 * @param document 変換対象のドキュメント
 * @returns `true`: ファイルを書き換えた, `false`: 書き換え不要だった
 */
function convertSavedFile(document: vscode.TextDocument): boolean {
  // スケジュール後にisClosed分岐やflushPendingConversionから直接呼ばれる経路がある
  // (クローズやdeactivateが挟まるケース)ため、ここでも設定無効化・EUC-JP以外への
  // エンコード変更を再チェックする(例: EUC-JPで保存後、UTF-8に「エンコード付きで
  // 保存」してからタブを閉じる、という手順を踏むとチェックなしにはファイルを破損する)
  if (!isConvertEnabled() || !canBeEUCJP(document)) {
    return false;
  }

  const fileName = document.fileName;

  // エンコードするよりファイルを直接読み込んだ方が実行時間が短い
  const content = fs.readFileSync(fileName);

  const convertedString = replaceSpecificCharactersInBuffer(content);

  // 変換対象がない場合は入力のBufferがそのまま返るため、参照比較だけで
  // 書き換え不要と判定できる
  if (
    convertedString === content ||
    Buffer.compare(convertedString, content) === 0
  ) {
    return false;
  }

  // VS Code 1.100.0未満にはTextDocument.encodingが無く、ここまでの判定(canBeEUCJP)は
  // 「EUC-JPかもしれない」までしか言えないため、読み込んだバイト列で最終確定させる
  // (1.100.0以降はO(1)で判定済みの結果を返すため以下の順序の議論は関係ない)。
  //
  // この判定をあえて置換の走査より後に置いているのは、1.100.0未満のisEUCJPBufferが
  // ファイル全体を走査するため。順序を逆にすると「一度変換したEUC-JPファイルを再保存する」
  // という日常的なケースで毎回この全走査を払うことになる(実測: 10MBで22.5ms -> 1.3ms)。
  // 逆に「EUC-JPとして不正だが変換対象のバイト列は含む」ファイル(Shift_JISの日本語ファイル
  // など。0x8FはShift_JISの有効なリードバイト)では、この順序だと不正判定より前に置換用
  // Bufferの確保・コピーを払う分だけ遅くなる(10MBで1.6〜2.4ms増)が、同じ関数が手前で
  // 払っているfs.readFileSyncより小さいため許容している。
  //
  // 安全性は順序に依存しない。replaceSpecificCharactersInBufferはBufferを読むだけで
  // 書き換えないため、書き込みは必ずこの判定を通過した後にしか起きない。この不変条件は
  // eucjp-legacy-path.test.tsでディスクの中身を確認する形で固定してある
  if (!isEUCJPConfirmed(document, content)) {
    return false;
  }

  fs.writeFileSync(fileName, convertedString, { flag: "w" });

  return true;
}

/**
 * 保存されたドキュメントの変換をデバウンス付きでスケジュールする
 *
 * デバウンスする理由・時間はSAVE_CONVERSION_DEBOUNCE_MSの定義を参照。
 * タイマーはドキュメントごと(URIごと)にcreateDebouncerで作成しsaveConversionDebouncersに
 * 保持し、2回目以降の保存では既存のDebouncerを再利用してscheduleし直すだけにする
 *
 * @param document 保存されたドキュメント
 */
function scheduleSaveConversion(document: vscode.TextDocument) {
  // 実ファイル以外(untitledなど)は変換対象外
  if (document.uri.scheme !== "file") {
    return;
  }

  if (!isConvertEnabled() || !canBeEUCJP(document)) {
    return;
  }

  // VS Code 1.100.0未満はcanBeEUCJPが常にtrueになるため、この足切りが無いと保存した
  // すべてのファイルがpendingConversionsに積まれ、クローズ/deactivate経由の
  // flushPendingConversion -> convertSavedFileが対象文字の有無を確認せず毎回ディスクを
  // 読むことになり、#633で削った読み込みが古いVS Codeでだけ復活してしまう。
  // ただし1.100.0未満ではこの判定自体がdocument.getText()による全文走査になるため、
  // #627 / #633で削った全文走査を完全には消せておらず、大きなファイルの保存時には
  // この分の遅延が残る(ディスクを読む前に使える判定材料が他に無いため許容している)
  if (
    needsBytesToDecideEUCJP(document) &&
    !containsConvertTargetCharacters(document)
  ) {
    return;
  }

  const key = document.uri.toString();

  pendingConversions.set(key, { document, postponed: false });

  let debouncer = saveConversionDebouncers.get(key);
  if (!debouncer) {
    debouncer = createDebouncer(() => {
      runScheduledConversion(key);
    }, SAVE_CONVERSION_DEBOUNCE_MS);
    saveConversionDebouncers.set(key, debouncer);
  }

  debouncer.schedule();
}

/**
 * スケジュールされていた変換を実行する
 *
 * 実行してよいかどうかを次の4分類で判定する:
 *
 * 1. ドキュメントが破棄済み(isClosed) -> そのまま変換する
 *    (モデルが無くetagの不整合が起きない)
 * 2. dirty(未保存の編集がある)        -> 先送り
 *    (issue #13。SAVE_CONVERSION_DEBOUNCE_MS参照)
 * 3. アクティブエディタではない        -> 先送り
 *    (revertがアクティブエディタにしか効かないため。非アクティブなまま変換すると
 *    etagが同期されずissue #13が再発することを実測で確認済み。詳細はsyncEditorWithConvertedFile参照)
 * 4. アクティブかつ非dirty            -> 変換 + revertでetagを同期する
 *
 * 2, 3で先送りしたものは、次の保存(再スケジュール)・onDidChangeActiveTextEditorでの
 * 再開(resumePendingConversionIfActive)・クローズ・deactivateのいずれかで実行される
 *
 * @param key pendingConversionsのキー(ドキュメントのURI文字列)
 */
function runScheduledConversion(key: string) {
  const pending = pendingConversions.get(key);
  if (!pending) {
    return;
  }

  const { document } = pending;

  if (document.isClosed) {
    pendingConversions.delete(key);
    saveConversionDebouncers.delete(key);
    convertSavedFile(document);
    return;
  }

  if (
    document.isDirty ||
    vscode.window.activeTextEditor?.document !== document
  ) {
    // 変換待ちの印だけを残して先送りする
    pendingConversions.set(key, { document, postponed: true });
    return;
  }

  pendingConversions.delete(key);

  const written = replaceSpecificCharacters(document);

  if (written) {
    // awaitできない(呼び出し元がDebouncerのコールバック)ため、
    // 内部でエラーを処理させる。revertが失敗しても追加のリカバリ手段は無い
    void syncEditorWithConvertedFile(document);
  }
}

/**
 * 先送りされていた変換を、ドキュメントがアクティブになったタイミングで再開する
 *
 * runScheduledConversionの3(アクティブエディタでなければ先送り)の受け皿。
 * 先送り中(postponed: true)のドキュメントが再びアクティブになった時だけ
 * runScheduledConversionを呼び直し、変換してよいかを再判定させる
 * (dirtyであれば引き続き先送りされる)
 *
 * 保存直後のデバウンス待ち(postponed: false)はここでは触らない。
 * デバウンスタイマー満了時にrunScheduledConversion自身が同じ判定を行う
 *
 * @param document アクティブになったエディタのドキュメント。エディタが無い場合はundefined
 */
function resumePendingConversionIfActive(
  document: vscode.TextDocument | undefined,
) {
  if (!document) {
    return;
  }

  const key = document.uri.toString();
  const pending = pendingConversions.get(key);
  if (!pending?.postponed) {
    return;
  }

  runScheduledConversion(key);
}

/**
 * 変換待ちのドキュメントがあれば、その場で変換する
 *
 * onDidCloseTextDocumentとdeactivateから呼ばれる。エディタ上の編集が破棄されている
 * 可能性があるため、ドキュメントのテキストは参照せずディスク上のファイルを直接変換する
 *
 * onDidCloseTextDocumentは「タブを閉じた時に発火する保証はない」とVS Codeの
 * APIドキュメントに明記されており、実測でもタブを閉じただけでは発火しないことを
 * 確認している。そのため「タブを閉じたら即座に変換される」ことは保証せず、
 * 破棄される(または拡張機能がdeactivateする)まで変換待ちのまま残ることを許容する
 *
 * 書き込みが発生した場合はsyncEditorWithConvertedFileでetagの同期も試みるが、
 * revertが効くのは対象がアクティブかつ非dirtyの場合のみ(詳細は同関数を参照)。
 * onDidCloseTextDocument経由(convertsEvenIfDirty: false)ではドキュメントは
 * 既にisClosedなので実質no-opになる(モデルが存在しないためetagの不整合はそもそも
 * 起きない)。deactivate経由(convertsEvenIfDirty: true)では、拡張機能ホストの
 * 再起動などでまだ生きているエディタモデルが対象の場合、アクティブかつ非dirtyで
 * あればrevertでetagを同期できる。postponedがdirty起因、または非アクティブ起因の
 * 場合は同期されないまま残るが、それらを外部から同期する公開APIはVS Codeに
 * 存在しないため、残余リスクとして許容する
 *
 * ドキュメントがクローズされる際は、変換が既にrunScheduledConversionの成功パスで
 * 完了していてpendingConversionsにエントリが残っていない場合でも、
 * scheduleSaveConversionが作成したDebouncerを必ず解放する。成功パスは
 * pendingConversionsのエントリだけを削除しDebouncerオブジェクト自体は
 * (次回保存での再利用のため)残すため、ここで解放しないと保存されたEUC-JPファイルの
 * URIごとにオブジェクトがsaveConversionDebouncersに溜まり続けてしまう
 *
 * @param key pendingConversionsのキー(ドキュメントのURI文字列)
 * @param convertsEvenIfDirty `true`: dirtyなドキュメントでも変換する(deactivate用)
 */
function flushPendingConversion(key: string, convertsEvenIfDirty = false) {
  saveConversionDebouncers.get(key)?.cancel();
  saveConversionDebouncers.delete(key);

  const pending = pendingConversions.get(key);
  if (!pending) {
    return;
  }

  const document = pending.document;

  // dirtyなまま書き換えると次の保存が「上書きに失敗しました」になる(issue #13。
  // SAVE_CONVERSION_DEBOUNCE_MS参照)ため、deactivate時(convertsEvenIfDirty: true)
  // 以外はガードする。deactivate後は保存が起きないため、スキップすると変換されない
  // まま終了してしまう(hot exit有効時はdirtyなドキュメントが確認なしに保持されるため
  // 実際に起こり得る)。
  // pendingConversionsを削除する前に判定するのは、先に削除すると先送りされていた
  // 変換の記録ごと失われ、以降のどのタイミングからも再試行されなくなるため
  if (!convertsEvenIfDirty && !document.isClosed && document.isDirty) {
    return;
  }

  pendingConversions.delete(key);

  const written = convertSavedFile(document);

  if (written) {
    void syncEditorWithConvertedFile(document);
  }
}

/**
 * 変換後のファイル状態をエディタ(VS Code本体)に同期する
 *
 * 拡張機能によるファイル書き換えはVS Codeが記録しているファイル状態(etag)に
 * 反映されないため、revertで再読込してetagを同期する。変換後のバイト列はデコードすると
 * 変換前と同一のテキストになるため、revertしてもエディタの内容・カーソル位置・
 * undoスタックには影響しない(VS CodeのupdateModelは内容が同一の場合何もしない)
 *
 * revertコマンドはアクティブエディタにしか作用しない。かつ非アクティブな背景タブの
 * 非dirtyドキュメントはディスクを書き換えてもVS Codeのファイルウォッチャーによる
 * 自動再読込が働かない(実測で確認済み。15秒待ってもリロードされない)。そのためこの
 * 関数は「対象ドキュメントがアクティブかつ非dirty」の場合にのみ呼び出す前提としている
 * (呼び出し元のrunScheduledConversionを参照)。非アクティブな場合にetagを同期する
 * 手段は無いため、変換自体をrunScheduledConversionの時点で先送りする方針にしている
 *
 * @param document 変換したファイルのドキュメント
 */
async function syncEditorWithConvertedFile(document: vscode.TextDocument) {
  // dirtyなドキュメントをrevertすると編集内容が失われるため、アクティブエディタが
  // 対象ドキュメントかつdirtyでない場合のみ実行する(呼び出し元で確認済みだが再確認する)。
  //
  // 既知の残余リスク(解消できていない): workbench.action.files.revertのコマンド
  // ハンドラ(VS Code 1.130.0のバンドルされたソースで確認)はexecuteCommandの第2引数
  // 以降を一切参照せず、対象は実行時点の「アクティブなエディタグループのアクティブ
  // エディタ」から解決される。つまりこのチェックからexecuteCommandが実際に処理される
  // までの間にユーザーがタブを切り替えると、無関係な別のドキュメントがrevertされ
  // (force:trueにより未保存編集が確認なしに失われ)得る。この窓を閉じる手段はVS Codeの
  // 公開APIには無い(ドキュメントを指定してrevertするAPIが存在しないため)
  const activeDocument = vscode.window.activeTextEditor?.document;
  if (activeDocument !== document || document.isDirty) {
    return;
  }

  try {
    await vscode.commands.executeCommand("workbench.action.files.revert");
  } catch {
    // revertに失敗した場合の追加リカバリ手段は無いため、ここでは無視する
  }
}

/**
 * 設定で変換が有効になっている変換対象を返す
 *
 * containsConvertTargetCharactersとreplaceSpecificCharactersInBufferの
 * 両方で同じ設定を読むため、読み込み処理を共通化する
 *
 * @returns 有効な変換対象の一覧(すべて無効なら空配列)
 */
function getConvertTargetConfig(): ConvertTarget[] {
  const config = vscode.workspace.getConfiguration("waveDashUnify");

  return CONVERT_TARGETS.filter(
    (target) => config.get<boolean>(target.configKey) === true,
  );
}

/**
 * ドキュメントに変換対象文字(CONVERT_TARGETSのchar)が含まれるかを判定する
 *
 * 設定で変換が無効化されている文字は判定対象に含めない
 * (例: fullwidthTildeToWaveDashがfalseなら全角チルダの有無は見ない)。
 * すべての設定がfalseの場合は変換が絶対に起きないため、document.getText()
 * (全文のUTF-16コピーを作る)を呼ばずに終了する
 *
 * @param document 判定対象のドキュメント(保存直後のものを想定)
 * @returns `true`: 変換対象文字が1つ以上含まれる, `false`: 含まれない
 */
export function containsConvertTargetCharacters(
  document: vscode.TextDocument,
): boolean {
  const targets = getConvertTargetConfig();

  if (targets.length === 0) {
    return false;
  }

  const text = document.getText();

  return targets.some((target) => text.includes(target.char));
}

/**
 * 拡張機能の動作設定(ID: waveDashUnify.enableConvert)の値を返す
 *
 * @returns `true`: 拡張機能の動作が有効, `false`: 拡張機能の動作が無効
 */
export function isConvertEnabled(): boolean {
  const config = vscode.workspace.getConfiguration("waveDashUnify");
  const enabled = config.get<boolean>("enableConvert");

  // package.jsonでdefaultを宣言している設定のため、undefinedにはならない。
  // 型のためだけの分岐で、到達したら安全側(変換しない)に倒す
  return enabled ?? false;
}

/**
 * バッファの指定位置がバイト列と一致するかを判定する
 *
 * @param str 検索対象のバッファ
 * @param position 比較を開始する位置
 * @param bytes 一致を確認するバイト列
 * @returns `true`: positionからbytesと一致する, `false`: 一致しない
 */
function matchesBytesAt(
  str: Buffer,
  position: number,
  bytes: readonly number[],
): boolean {
  if (position + bytes.length > str.length) {
    return false;
  }

  for (let offset = 0; offset < bytes.length; offset++) {
    if (str[position + offset] !== bytes[offset]) {
      return false;
    }
  }

  return true;
}

/**
 * 与えられたバッファ中の特定のバイト列を置き換えたバッファを返す
 *
 * 置き換える対象はCONVERT_TARGETS(設定で有効なものだけ)
 *
 * @param str 変換したいバッファ
 * @returns 変換後のバッファ(変換対象が1つも無ければ引数のバッファそのもの)
 */
export function replaceSpecificCharactersInBuffer(str: Buffer): Buffer {
  const targets = getConvertTargetConfig();

  if (targets.length === 0) {
    return str;
  }

  // 変換対象のバイト列はいずれもSS3で始まるため、ネイティブ実装で高速な
  // indexOfでSS3の位置だけを走査し、その候補位置でのみバイト列を比較する
  const SS3 = 0x8f; // EUC-JPのシングルシフト(SS3)バイト。変換対象の先頭バイト

  let converted: Buffer | undefined;
  let writePos = 0; // convertedへの書き込み済み位置
  let copiedPos = 0; // strのコピー済み位置
  let i = str.indexOf(SS3);

  while (i !== -1) {
    const position = i;
    const target = targets.find((candidate) =>
      matchesBytesAt(str, position, candidate.from),
    );

    if (target) {
      // to.length <= from.lengthのため、変換後は元の長さを超えない
      converted ??= Buffer.allocUnsafe(str.length);

      writePos += str.copy(converted, writePos, copiedPos, position);
      for (const byte of target.to) {
        converted[writePos++] = byte;
      }
      copiedPos = position + target.from.length;
      i = str.indexOf(SS3, copiedPos);
    } else {
      i = str.indexOf(SS3, position + 1);
    }
  }

  // 変換対象が1つもなければ、入力のBufferをそのまま返す
  if (!converted) {
    return str;
  }

  writePos += str.copy(converted, writePos, copiedPos);

  return converted.subarray(0, writePos);
}

/**
 * ステータスバーにWaveDashUnifyの状態を表示する
 */
export function setupStatusBarItem() {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
  );

  statusBarItem.name = "Wave Dash Unify";
  statusBarItem.command = "waveDashUnify.SelectEnableOrDisable";

  updateStatusBarItem(statusBarItem);
}

/**
 * 文字列中に指定した1文字(target)が何回出現するかを数える
 *
 * String#indexOfはネイティブ実装のため、for...ofによるコードポイント走査より高速
 * (10MB級の文字列で計測したところ、本関数を使う実装はfor...of実装の1/10程度の時間で完了した)
 *
 * @param str 検索対象の文字列
 * @param target 検索する1文字
 * @returns targetの出現回数
 */
function countOccurrences(str: string, target: string): number {
  let count = 0;
  let pos = str.indexOf(target);

  while (pos !== -1) {
    count++;
    pos = str.indexOf(target, pos + target.length);
  }

  return count;
}

/**
 * 全角チルダ、波ダッシュ、およびNUMERO SIGNの個数を数える
 *
 * 全角チルダと波ダッシュは同じ文字として扱う
 *
 * EUC-JPのファイルではWAVE_DASH_CHAR(U+301C)の項が常に0件になり、
 * 変換の前後でこのカウントは変化しない。理由と、それでも項を残している
 * 判断についてはWAVE_DASH_CHARの定義箇所のコメントを参照
 *
 * @param str 文字列
 * @returns 各文字の個数を含む辞書
 */
export function countSpecificCharacters(str: string): {
  waveDashAndFullwidthTilde: number;
  numeroSign: number;
} {
  return {
    waveDashAndFullwidthTilde:
      countOccurrences(str, WAVE_DASH_CHAR) +
      countOccurrences(str, FULLWIDTH_TILDE_CHAR),
    numeroSign: countOccurrences(str, NUMERO_SIGN_CHAR),
  };
}

/**
 * ステータスバーに全角チルダを波ダッシュに変換する機能の有効/無効と対象文字の個数を表示する
 *
 * @param statusBarItem ステータスバーに表示する項目
 */
export function updateStatusBarItem(statusBarItem: vscode.StatusBarItem) {
  const activeEditor = vscode.window.activeTextEditor;

  const config = vscode.workspace.getConfiguration("waveDashUnify");
  const format = config.get<string>("statusBarFormat");
  // package.jsonでdefaultを宣言している設定のため、undefinedにはならない。
  // 型のためだけの分岐で、ここに到達したらステータスバーの更新自体を諦める
  if (format === undefined) {
    return;
  }

  // アクティブなテキストエディタがファイルではない場合は
  // 全角チルダと波ダッシュの個数を表示しても意味がないので、
  // ステータスバーの表示領域のスペースを空けるために非表示にする
  if (!activeEditor) {
    statusBarItem.hide();
    return;
  }

  statusBarItem.show();

  const isEnabled = isConvertEnabled();
  statusBarItem.tooltip = isEnabled
    ? "Wave Dash Unify is enabled"
    : "Wave Dash Unify is disabled";

  const count = countSpecificCharacters(activeEditor.document.getText());

  statusBarItem.text = format
    .replace("${statusIcon}", isEnabled ? "$(pass-filled)" : "$(error)")
    .replace(
      "${waveDashAndFullwidthTildeCount}",
      count.waveDashAndFullwidthTilde.toString(),
    )
    .replace("${numeroSignCount}", count.numeroSign.toString());
}

export function deactivate() {
  statusBarUpdateDebouncer.cancel();

  // 変換待ちのファイルを残さないように、終了前にすべて変換する。
  // これ以降の保存は起きないため、dirtyなものも変換する(第2引数)。
  // 1件のファイルアクセス失敗(外部でファイルが削除された場合など)が
  // 残りのキーのflushとstatusBarItem.dispose()を止めないよう、
  // キーごとにエラーを分離する
  for (const key of [...pendingConversions.keys()]) {
    try {
      flushPendingConversion(key, true);
    } catch {
      // deactivate中の失敗に追加のリカバリ手段は無いため、ここでは無視する
    }
  }

  statusBarItem.dispose();
}
