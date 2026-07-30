import * as vscode from "vscode";
import * as fs from "fs";
import { createDebouncer, Debouncer } from "./debounce";
import { canBeEUCJP, isEUCJPConfirmed, needsBytesToDecideEUCJP } from "./eucjp";

export const WAVEDASH_CODE_POINT = 0x301c;
export const FULLWIDTH_TILDE_CODE_POINT = 0xff5e;
export const NUMERO_SIGN_CODE_POINT = 0x2116;

// countSpecificCharactersでString#indexOfを使うために、事前に1文字だけの文字列に変換しておく
// (いずれもサロゲートペアにならないコードポイントのため、1コード単位の文字列として扱える)
//
// WAVE_DASH_CHAR(U+301C)は、EUC-JPのファイルを扱う限りテキスト中に出現しない。
// VS CodeのEUC-JPコーデックは 0xA1 0xC1(波ダッシュのバイト列)も
// 0x8F 0xA2 0xB7(全角チルダのバイト列)も等しくU+FF5Eにデコードし、
// 逆にU+301Cをエンコードすると表現できず'?'(0x3F)になる。
// そのため変換対象であるEUC-JPのファイルに限れば、WAVE_DASH_CHARを使った
// カウントは常に0件になる(issue #635)。
// ただしステータスバーのカウント(updateStatusBarItem)はドキュメントの
// エンコーディングを問わず動くため、UTF-8のファイルを開いている場合は
// U+301Cが現時点で実際にカウントされる。この項を削除するとその表示が
// 変わってしまうため残している。
// EUC-JP側の前提はsrc/test/suite/eucjp-encoding-invariants.test.tsで
// 固定してある
const WAVE_DASH_CHAR = String.fromCodePoint(WAVEDASH_CODE_POINT);
const FULLWIDTH_TILDE_CHAR = String.fromCodePoint(FULLWIDTH_TILDE_CODE_POINT);
const NUMERO_SIGN_CHAR = String.fromCodePoint(NUMERO_SIGN_CODE_POINT);

/**
 * 変換対象の一覧
 *
 * 「何を変換するか」の唯一の定義。Unicode文字での判定
 * (containsConvertTargetCharacters)とバイト列での変換
 * (replaceSpecificCharactersInBuffer)の両方をこのテーブルから駆動するため、
 * 変換対象を増やすときはここに1エントリ追加するだけで両方に反映される
 *
 * 各エントリは以下を満たす必要がある(replaceSpecificCharactersInBufferの
 * 実装がこれらに依存している)
 * - fromはEUC-JPのSS3バイト(0x8F)で始まる: SS3の位置だけをindexOfで走査して
 *   候補位置を絞るため
 * - to.length <= from.length: 出力用Bufferを入力と同じ長さで確保するため
 */
export const CONVERT_TARGETS = [
  {
    char: FULLWIDTH_TILDE_CHAR,
    configKey: "fullwidthTildeToWaveDash",
    from: [0x8f, 0xa2, 0xb7], // 全角チルダ
    to: [0xa1, 0xc1], // 波ダッシュ
  },
  {
    char: NUMERO_SIGN_CHAR,
    configKey: "numeroSignToNumeroSign",
    from: [0x8f, 0xa2, 0xf1], // 全角NO
    to: [0xad, 0xe2], // 全角NO
  },
] as const;

type ConvertTarget = (typeof CONVERT_TARGETS)[number];

// ステータスバー更新のデバウンス時間(ms)
// キーストロークのたびに全文スキャンが走らないように、この時間内の連続更新要求を1回にまとめる
const STATUS_BAR_UPDATE_DEBOUNCE_MS = 200;

// 保存後の変換を実行するまでのデバウンス時間(ms)
// Ctrl+S長押しなどで保存イベントが連続する間はファイルを書き換えず、
// 保存が落ち着いてから1回だけ変換する。保存の合間に拡張機能がファイルを
// 書き換えると、VS Codeが記録しているファイル状態(etag)とディスクがズレて
// 次の保存が「上書きに失敗しました」になるため(issue #13)
//
// 300msという値自体に実測データに基づく厳密な根拠はない。
// 「OSのキーリピートによる連打(間隔は数十ms程度)よりは確実に長く、
// 人が意図して次の保存操作をするまでの間隔よりは短い」という経験則で
// 選んだ暫定値。この不等式さえ満たせば正しさは変わらないため、
// 体感で長すぎる/短すぎると感じた場合は変更して問題ない
export const SAVE_CONVERSION_DEBOUNCE_MS = 300;

let statusBarItem: vscode.StatusBarItem;

// ステータスバー更新のデバウンサ。setupStatusBarItemによる再代入後も
// 正しいstatusBarItemを使うように、値ではなく変数を捕捉するクロージャにする
const statusBarUpdateDebouncer = createDebouncer(() => {
  updateStatusBarItem(statusBarItem);
}, STATUS_BAR_UPDATE_DEBOUNCE_MS);

// 保存済みで変換待ちのドキュメント(キー: ドキュメントのURI文字列)
// postponedがtrueのものは「dirtyだった、またはアクティブエディタでなかったため
// 変換を先送りした」状態で、次の保存・アクティブ化・クローズ・deactivateの
// いずれかのタイミングで変換される(判定はrunScheduledConversionを参照)。
// デバウンスのタイマー自体はsaveConversionDebouncersが個別に保持する
const pendingConversions = new Map<
  string,
  {
    document: vscode.TextDocument;
    postponed: boolean;
  }
>();

// 保存後変換のデバウンサ(キー: ドキュメントのURI文字列)。ステータスバー更新の
// デバウンス(statusBarUpdateDebouncer)と同じcreateDebouncerを使うことで、
// キャンセル・再スケジュールのロジックを共有する
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
      // 保存イベントの連続発火中に書き換えると保存と競合するため、デバウンスして実行する
      vscode.workspace.onDidSaveTextDocument((document) => {
        scheduleSaveConversion(document);
      }),
      // 変換待ちのままドキュメントが破棄された場合は、その場で変換する
      // (モデルが存在しなくなるためetagの不整合が起きない)
      vscode.workspace.onDidCloseTextDocument((document) => {
        flushPendingConversion(document.uri.toString());
      }),
      // アクティブファイルが変更された時や文字が変更された時に、ステータスバーの表示を更新する
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

        // 連続するキーストロークのたびに全文スキャンが走らないように、更新をデバウンスする
        statusBarUpdateDebouncer.schedule();
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        // この拡張機能に関係ない設定変更では更新不要
        if (!e.affectsConfiguration("waveDashUnify")) {
          return;
        }

        updateStatusBarItem(statusBarItem);
      }),

      // StatusBarのクリックイベントを登録
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

  // 変換対象文字がドキュメントに1つもなければ、ディスクを読みに行く必要すらない。
  // これが安全なのは「保存直後のテキストが真実源だから」ではなく、EUC-JPで
  // 0x8F 0xA2 0xB7(全角チルダ)を生成できる文字がU+FF5E以外に無く、
  // 0x8F 0xA2 0xF1(全角NO)を生成できる文字もU+2116以外に無いため。
  // つまりテキスト上の判定は「変換対象バイト列の有無」の安全側の過剰近似になる
  // (変換後のバイト列0xA1 0xC1 / 0xAD 0xE2はデコードするとそれぞれU+FF5E /
  // U+2116に戻るため、既に変換済みのファイルも取りこぼされない)
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
  // 変換をスケジュールした後に設定で無効化・EUC-JP以外へのエンコード変更が
  // 行われた場合は何もしない。スケジュール時点(scheduleSaveConversion)や
  // replaceSpecificCharactersでしか確認しないと、isClosed分岐や
  // flushPendingConversionがこの関数を直接呼ぶ経路(スケジュール後にクローズや
  // deactivateが起きた場合)で無効化・エンコード変更を無視してディスクを
  // 書き換えてしまう(例: EUC-JPで保存してスケジュールが成立した後、
  // 「エンコード付きで保存」でUTF-8に変換してからタブを閉じる、という手順を
  // 踏むとこのチェックなしにはファイルを破損しうる)
  if (!isConvertEnabled() || !canBeEUCJP(document)) {
    return false;
  }

  const fileName = document.fileName;

  // エンコードするよりも、ファイルを直接読み込んだ方が実行時間が短い
  // const content = Buffer.from(await vscode.workspace.encode(document.getText(), { encoding: "EUC-JP" }));
  const content = fs.readFileSync(fileName);

  const convertedString = replaceSpecificCharactersInBuffer(content);

  // 変換対象がない場合は入力のBufferがそのまま返るため、参照比較だけで書き換え不要と判定できる
  if (
    convertedString === content ||
    Buffer.compare(convertedString, content) === 0
  ) {
    return false;
  }

  // ファイルを書き換える直前の最終判定。VS Code 1.100.0未満には
  // TextDocument.encodingが無く、ここまでの判定(canBeEUCJP)は
  // 「EUC-JPかもしれない」までしか言えていない。読み込んだバイト列を使って
  // ここで確定させる(1.100.0以降ではバイト列を見ずに判定済みの結果を返す)
  //
  // この判定は置換の走査より「後」に置く。置換対象が1つも無ければ
  // ディスクは書き換わらないので、そもそもエンコーディングを確定させる必要が無い。
  // 1.100.0未満のisEUCJPBufferはファイル全体を走査するため、順序を逆にすると
  // 「この拡張機能が一度変換したEUC-JPファイルを再保存する」という日常的な
  // ケース(テキストには～があるので足切りを通るが、バイト列は既に変換済みで
  // 置換は発生しない)で毎回この全走査を払うことになる。
  // 実測では10MBのファイルで22.5ms -> 1.3msになった。
  // 1.100.0以降はどちらの順序でもO(1)で変わらない。
  //
  // 逆に遅くなるケースもある。「EUC-JPとして不正だが変換対象のバイト列は含む」
  // ファイル(現実的にはShift_JISの日本語ファイル。0x8FはShift_JISの有効な
  // リードバイトのため)では、順序が逆なら不正なバイトを見つけた時点で
  // 即座に弾けたところを、置換用Bufferの確保とコピーの分だけ余計に払う。
  // 10MBで1.6〜2.4msの増加で、同じ関数が手前で払っているfs.readFileSyncより
  // 小さいため許容している
  //
  // 安全性は順序に依存しない。replaceSpecificCharactersInBufferは
  // 引数のBufferを読むだけで書き換えず(返すのは引数そのものか新しいBufferの
  // どちらか)副作用が無いため、書き込みは必ずこの判定を通過した後にしか起きない。
  // この不変条件はsrc/test/suite/eucjp-legacy-path.test.tsで、
  // 実際にディスクの中身を確認する形で固定してある
  if (!isEUCJPConfirmed(document, content)) {
    return false;
  }

  fs.writeFileSync(fileName, convertedString, { flag: "w" });

  return true;
}

/**
 * 保存されたドキュメントの変換をデバウンス付きでスケジュールする
 *
 * Ctrl+S長押しなどで保存が連続する間はタイマーをリセットし続け、
 * 保存が止まってからSAVE_CONVERSION_DEBOUNCE_MSが経過した時点で1回だけ変換する。
 * これにより保存イベントの連続中はVS Code自身の書き込みしか発生せず、
 * VS Codeが記録しているファイル状態(etag)とディスクがズレないため、
 * 「上書きに失敗しました」(issue #13)が発生しない
 *
 * タイマー自体はドキュメントごと(URIごと)にcreateDebouncerで作成し
 * saveConversionDebouncersに保持する。2回目以降の保存では既存のDebouncerを
 * 再利用してscheduleし直すだけで、キャンセル・再作成のロジックはcreateDebouncer側に
 * 任せられる
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

  // VS Code 1.100.0未満ではcanBeEUCJPが常にtrueになるため、この足切りが無いと
  // 保存したすべてのファイルがpendingConversionsに積まれてしまう。すると
  // クローズやdeactivateからのflushPendingConversion -> convertSavedFileの経路が
  // 変換対象文字の有無を確認しないまま毎回ディスクを読むことになり、
  // #633で削った読み込みが古いVS Codeでだけ復活する。
  // containsConvertTargetCharactersは保存直後のテキストを見るため、
  // ここで対象文字が無ければ「この保存で変換すべきものは無い」と言い切れる。
  //
  // ただしこの足切り自体もコストを持つ。1.100.0以降はisEUCJPDocumentが
  // O(1)でEUC-JP以外を落とすのでここには来ないが、1.100.0未満では
  // エンコーディングを問わず保存されたすべてのファイルで
  // containsConvertTargetCharacters(= document.getText()による全文のUTF-16コピー
  // と走査)が走る。つまり#627 / #633で削った全文走査を完全には消せておらず、
  // 古いVS Codeでは大きなファイルの保存時にこの分の遅延が残る。
  // ディスクを読む前に使える判定材料が他に無いため、
  // 「毎回ディスクを読む」よりは軽いこちらを選んでいる
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
 * 1. ドキュメントが破棄済み(isClosed)      -> そのまま変換する
 *    (モデルが存在しないのでetagの不整合が起きない)
 * 2. dirty(未保存の編集がある)             -> 先送り
 *    ここでファイルを書き換えると、その後の保存が「上書きに失敗しました」になる
 * 3. アクティブエディタではない             -> 先送り
 *    etagの同期手段であるrevertはアクティブエディタにしか作用しないため、
 *    非アクティブなまま変換するとetagが同期されずissue #13が再発する
 *    (実測で確認済み。VS Codeのファイルウォッチャーによる自動再読込にも委ねられない)
 * 4. アクティブかつ非dirty                 -> 変換 + revertでetagを同期する
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
 * onDidCloseTextDocumentは「ドキュメントが破棄された時」に発火するイベントであり、
 * VS CodeのAPIドキュメントにも「タブを閉じた時に発火する保証はない」と明記されている
 * (実測でも、タブを閉じただけでは発火しないことを確認した)。そのため「タブを閉じたら
 * 即座に変換される」ことは保証しない。破棄される(または拡張機能がdeactivateする)まで
 * 変換待ちのまま残ることを許容する
 *
 * 書き込みが発生した場合はsyncEditorWithConvertedFileでetagの同期も試みる。
 * onDidCloseTextDocument経由(convertsEvenIfDirty: false)ではドキュメントは
 * 既にisClosedなのでactiveTextEditorと一致せず実質no-opになる(モデルが
 * 存在しないためetagの不整合はそもそも起きない)。deactivate経由
 * (convertsEvenIfDirty: true)では、対象が「拡張機能ホストの再起動」などで
 * まだ生きているエディタモデルの場合があり、そのドキュメントがアクティブかつ
 * 非dirtyであればここでrevertしてetagを同期できる。postponedがdirty起因、
 * または非アクティブ起因の場合はsyncEditorWithConvertedFile内部のチェックで
 * 何もしない(revertはアクティブかつ非dirtyの場合のみ意味を持ち、それ以外を
 * 外部から同期する公開APIはVS Codeに存在しないため、残余リスクとして許容する)
 *
 * ドキュメントがクローズされる際は、変換が既にrunScheduledConversionの成功パスで
 * 完了していてpendingConversionsにエントリが残っていない場合でも、
 * scheduleSaveConversionが作成したDebouncerを必ず解放する。成功パスは
 * pendingConversionsのエントリだけを削除しDebouncerオブジェクト自体は
 * (同じファイルへの次回保存で再利用できるよう)残すため、ここで解放しないと
 * 一度でも保存されたEUC-JPファイルのURIごとにオブジェクトがsaveConversionDebouncers
 * に溜まり続けてしまう
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

  // dirtyなまま書き換えると、その後の保存が「上書きに失敗しました」になる(issue #13)。
  // onDidCloseTextDocument発火時点でdirtyになっていることは通常ないが、防御的にガードする。
  // ただしdeactivate時はこれ以降の保存が起きないため、dirtyでも変換する
  // (ここでスキップすると変換されないまま終了してしまう。hot exitが有効な場合、
  //  dirtyなドキュメントは確認ダイアログなしで保持されるため、この状態は実際に起こり得る)
  //
  // このガードはpendingConversionsを削除する前に判定する。先に削除すると、
  // 変換をスキップした場合でも先送りされていた変換の記録ごと失われてしまい、
  // 以降の保存・アクティブ化・deactivateのいずれからも二度と再試行されなくなる
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
 * 反映されないため、revertで再読込してetagを同期する。変換後のバイト列は
 * デコードすると変換前と同一のテキストになるため、revertしてもエディタの内容・
 * カーソル位置・undoスタックには影響しない(VS CodeのupdateModelは内容が
 * 同一の場合何もしない)
 *
 * revertコマンドはアクティブエディタにしか作用しない。かつ、非アクティブな
 * 背景タブの非dirtyドキュメントはディスクを書き換えてもVS Codeのファイル
 * ウォッチャーによる自動再読込が働かない(実測で確認済み。15秒待っても
 * リロードされない)。そのためこの関数は「対象ドキュメントがアクティブかつ
 * 非dirty」の場合にのみ呼び出す前提としている(呼び出し元のrunScheduledConversion
 * を参照)。非アクティブな場合にetagを同期する手段は無いため、変換自体を
 * runScheduledConversionの時点で先送りする方針にしている
 *
 * @param document 変換したファイルのドキュメント
 */
async function syncEditorWithConvertedFile(document: vscode.TextDocument) {
  // dirtyなドキュメントをrevertすると編集内容が失われるため、
  // アクティブエディタが対象ドキュメントかつdirtyでない場合のみ実行する
  // (呼び出し元で既に確認済みだが、防御的に再確認する)。
  //
  // 既知の残余リスク(解消できていない): workbench.action.files.revertの
  // コマンドハンドラの実装(VS Code 1.130.0のバンドルされたソースで確認)は
  // ServicesAccessorのみを引数に取る関数であり、executeCommandの第2引数
  // 以降は一切参照されない。対象はハンドラ実行時点の「アクティブなエディタ
  // グループのアクティブエディタ」から解決される(エクスプローラの選択状態が
  // 無い限り)。つまりdocument.uriのような引数を渡しても対象を固定する効果は
  // 無く、このチェックからexecuteCommandがレンダラー側で実際に処理される
  // までの間にユーザーがタブを切り替えた場合、無関係な別のドキュメントが
  // revertされる(その未保存編集がforce:trueにより確認なしに失われる)余地が
  // 理論上残っている。この窓を拡張機能のコードから閉じる手段はVS Codeの
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

  // waveDashUnify.numeroSignToNumeroSignなどの設定にかかわらず、
  // 対象文字の個数を表示する

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
