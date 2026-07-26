import * as vscode from "vscode";
import * as fs from "fs";
import { createDebouncer } from "./debounce";

export const WAVEDASH_CODE_POINT = 0x301c;
export const FULLWIDTH_TILDE_CODE_POINT = 0xff5e;
export const NUMERO_SIGN_CODE_POINT = 0x2116;

// countSpecificCharactersでString#indexOfを使うために、事前に1文字だけの文字列に変換しておく
// (いずれもサロゲートペアにならないコードポイントのため、1コード単位の文字列として扱える)
const WAVE_DASH_CHAR = String.fromCodePoint(WAVEDASH_CODE_POINT);
const FULLWIDTH_TILDE_CHAR = String.fromCodePoint(FULLWIDTH_TILDE_CODE_POINT);
const NUMERO_SIGN_CHAR = String.fromCodePoint(NUMERO_SIGN_CODE_POINT);

// ステータスバー更新のデバウンス時間(ms)
// キーストロークのたびに全文スキャンが走らないように、この時間内の連続更新要求を1回にまとめる
const STATUS_BAR_UPDATE_DEBOUNCE_MS = 200;

// 保存後の変換を実行するまでのデバウンス時間(ms)
// Ctrl+S長押しなどで保存イベントが連続する間はファイルを書き換えず、
// 保存が落ち着いてから1回だけ変換する。保存の合間に拡張機能がファイルを
// 書き換えると、VS Codeが記録しているファイル状態(etag)とディスクがズレて
// 次の保存が「上書きに失敗しました」になるため(issue #13)
export const SAVE_CONVERSION_DEBOUNCE_MS = 300;

let statusBarItem: vscode.StatusBarItem;

// ステータスバー更新のデバウンサ。setupStatusBarItemによる再代入後も
// 正しいstatusBarItemを使うように、値ではなく変数を捕捉するクロージャにする
const statusBarUpdateDebouncer = createDebouncer(
  () => updateStatusBarItem(statusBarItem),
  STATUS_BAR_UPDATE_DEBOUNCE_MS,
);

// 保存済みで変換待ちのドキュメント(キー: ドキュメントのURI文字列)
// timerがundefinedのものは「dirtyだった、またはアクティブエディタでなかったため
// 変換を先送りした」状態で、次の保存・アクティブ化・クローズ・deactivateの
// いずれかのタイミングで変換される(判定はrunScheduledConversionを参照)
const pendingConversions = new Map<
  string,
  {
    document: vscode.TextDocument;
    timer: ReturnType<typeof setTimeout> | undefined;
  }
>();

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

            if (selectedItem.label === "Enable convert") {
              vscode.commands.executeCommand("waveDashUnify.enableConvert");
            } else if (selectedItem.label === "Disable convert") {
              vscode.commands.executeCommand("waveDashUnify.disableConvert");
            }

            quickPick.hide();
          });

          quickPick.onDidHide(() => quickPick.dispose());

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

  if (!isEUCJP(document)) {
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

  return convertSavedFile(document.fileName);
}

/**
 * ディスク上のファイルを読み込み、変換対象のバイト列があれば書き換える
 *
 * ドキュメントのテキストを参照しないため、エディタ上の未保存の編集内容に
 * かかわらず「最後に保存された内容」を基準に変換できる
 *
 * @param fileName 変換対象のファイルのパス
 * @returns `true`: ファイルを書き換えた, `false`: 書き換え不要だった
 */
function convertSavedFile(fileName: string): boolean {
  // 変換をスケジュールした後に設定で無効化された場合は何もしない。
  // スケジュール時点(scheduleSaveConversion)でしか確認しないと、
  // 無効化した後にクローズやdeactivateが起きた時点で、無効化を無視して
  // ディスクを書き換えてしまう
  if (!isConvertEnabled()) {
    return false;
  }

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
 * @param document 保存されたドキュメント
 */
function scheduleSaveConversion(document: vscode.TextDocument) {
  // 実ファイル以外(untitledなど)は変換対象外
  if (document.uri.scheme !== "file") {
    return;
  }

  if (!isConvertEnabled() || !isEUCJP(document)) {
    return;
  }

  const key = document.uri.toString();

  const pending = pendingConversions.get(key);
  if (pending?.timer !== undefined) {
    clearTimeout(pending.timer);
  }

  const timer = setTimeout(() => {
    runScheduledConversion(key, document);
  }, SAVE_CONVERSION_DEBOUNCE_MS);

  pendingConversions.set(key, { document, timer });
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
 * @param document 変換対象のドキュメント
 */
function runScheduledConversion(key: string, document: vscode.TextDocument) {
  if (document.isClosed) {
    pendingConversions.delete(key);
    convertSavedFile(document.fileName);
    return;
  }

  if (
    document.isDirty ||
    vscode.window.activeTextEditor?.document !== document
  ) {
    // 変換待ちの印だけを残して先送りする(timer: undefined)
    pendingConversions.set(key, { document, timer: undefined });
    return;
  }

  pendingConversions.delete(key);

  const written = replaceSpecificCharacters(document);

  if (written) {
    // awaitできない(呼び出し元がsetTimeoutのコールバック)ため、
    // 内部でエラーを処理させる。revertが失敗しても追加のリカバリ手段は無い
    void syncEditorWithConvertedFile(document);
  }
}

/**
 * 先送りされていた変換を、ドキュメントがアクティブになったタイミングで再開する
 *
 * runScheduledConversionの3(アクティブエディタでなければ先送り)の受け皿。
 * 先送り中(timer: undefined)のドキュメントが再びアクティブになった時だけ
 * runScheduledConversionを呼び直し、変換してよいかを再判定させる
 * (dirtyであれば引き続き先送りされる)
 *
 * 保存直後のデバウンス待ち(timer !== undefined)はここでは触らない。
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
  if (!pending || pending.timer !== undefined) {
    return;
  }

  runScheduledConversion(key, document);
}

/**
 * 変換待ちのドキュメントがあれば、その場で変換する
 *
 * onDidCloseTextDocumentとdeactivateから呼ばれる。いずれもドキュメントが
 * 破棄される(またはこれ以上保存が起きない)場面のため、ディスクを書き換えても
 * 以降の保存と競合しない。エディタ上の編集が破棄されている可能性があるため、
 * ドキュメントのテキストは参照せずディスク上のファイルを直接変換する
 *
 * onDidCloseTextDocumentは「ドキュメントが破棄された時」に発火するイベントであり、
 * VS CodeのAPIドキュメントにも「タブを閉じた時に発火する保証はない」と明記されている
 * (実測でも、タブを閉じただけでは発火しないことを確認した)。そのため「タブを閉じたら
 * 即座に変換される」ことは保証しない。破棄される(または拡張機能がdeactivateする)まで
 * 変換待ちのまま残ることを許容する
 *
 * @param key pendingConversionsのキー(ドキュメントのURI文字列)
 */
function flushPendingConversion(key: string, convertsEvenIfDirty = false) {
  const pending = pendingConversions.get(key);
  if (!pending) {
    return;
  }

  if (pending.timer !== undefined) {
    clearTimeout(pending.timer);
  }
  pendingConversions.delete(key);

  const document = pending.document;

  // dirtyなまま書き換えると、その後の保存が「上書きに失敗しました」になる(issue #13)。
  // onDidCloseTextDocument発火時点でdirtyになっていることは通常ないが、防御的にガードする。
  // ただしdeactivate時はこれ以降の保存が起きないため、dirtyでも変換する
  // (ここでスキップすると変換されないまま終了してしまう。hot exitが有効な場合、
  //  dirtyなドキュメントは確認ダイアログなしで保持されるため、この状態は実際に起こり得る)
  if (!convertsEvenIfDirty && !document.isClosed && document.isDirty) {
    return;
  }

  convertSavedFile(document.fileName);
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
  // (呼び出し元で既に確認済みだが、防御的に再確認する)
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
 * ドキュメントに変換対象文字(全角チルダ、全角NO)が含まれるかを判定する
 *
 * 設定で変換が無効化されている文字は判定対象に含めない
 * (例: fullwidthTildeToWaveDashがfalseなら全角チルダの有無は見ない)。
 * 両方の設定がfalseの場合は変換が絶対に起きないため、document.getText()
 * (全文のUTF-16コピーを作る)を呼ばずに終了する
 *
 * @param document 判定対象のドキュメント(保存直後のものを想定)
 * @returns `true`: 変換対象文字が1つ以上含まれる, `false`: 含まれない
 */
export function containsConvertTargetCharacters(
  document: vscode.TextDocument,
): boolean {
  const config = vscode.workspace.getConfiguration("waveDashUnify");

  const convertsFullwidthTilde = config.get(
    "fullwidthTildeToWaveDash",
  ) as boolean;
  const convertsNumeroSign = config.get("numeroSignToNumeroSign") as boolean;

  if (!convertsFullwidthTilde && !convertsNumeroSign) {
    return false;
  }

  const text = document.getText();

  if (convertsFullwidthTilde && text.includes(FULLWIDTH_TILDE_CHAR)) {
    return true;
  }

  if (convertsNumeroSign && text.includes(NUMERO_SIGN_CHAR)) {
    return true;
  }

  return false;
}

/**
 * 拡張機能の動作設定(ID: waveDashUnify.enableConvert)の値を返す
 *
 * @returns `true`: 拡張機能の動作が有効, `false`: 拡張機能の動作が無効
 */
export function isConvertEnabled(): boolean {
  const config = vscode.workspace.getConfiguration("waveDashUnify");

  return config.get("enableConvert") as boolean;
}

/**
 * ファイルの文字コードがEUC-JPかを判定する
 *
 * VS Code 1.100.0以降ではTextDocument.encodingで判定する。
 * ASCIIのみのファイルもEUC-JPと判定される
 *
 * @param str 判定する文字列またはTextDocument
 * @returns `true`: EUC-JP, `false`: EUC-JP以外
 */
export function isEUCJP(str: vscode.TextDocument): boolean {
  // VS Code 1.100.0以降: TextDocument.encodingが使える
  return str.encoding === "eucjp";
}

/**
 * 与えられた文字列中の特定文字を置き換えた文字列を返す
 * 置き換える文字は以下
 * | 置き換え前                  | 置き換え後             |
 * | --------------------------- | ---------------------- |
 * | 全角チルダ (0x8F 0xA2 0xB7) | 波ダッシュ (0xA1 0xC1) |
 * | 全角NO     (0x8F 0xA2 0xF1) | 全角NO     (0xAD 0xE2) |
 *
 * @param str 変換したい文字列
 * @returns 変換後の文字列
 */
export function replaceSpecificCharactersInBuffer(str: Buffer): Buffer {
  const config = vscode.workspace.getConfiguration("waveDashUnify");

  const convertsFullwidthTilde = config.get(
    "fullwidthTildeToWaveDash",
  ) as boolean;
  const convertsNumeroSign = config.get("numeroSignToNumeroSign") as boolean;

  if (!convertsFullwidthTilde && !convertsNumeroSign) {
    return str;
  }

  // 変換対象はいずれも 0x8F 0xA2 で始まる3バイト列のため、
  // ネイティブ実装で高速な indexOf で先頭バイトの候補位置だけを走査する
  const SS3 = 0x8f; // EUC-JPのシングルシフト(SS3)バイト。変換対象の先頭バイト

  let converted: Buffer | undefined;
  let writePos = 0; // convertedへの書き込み済み位置
  let copiedPos = 0; // strのコピー済み位置
  let i = str.indexOf(SS3);

  while (i !== -1 && i + 2 < str.length) {
    let replacement: [number, number] | undefined;

    if (str[i + 1] === 0xa2) {
      if (convertsFullwidthTilde && str[i + 2] === 0xb7) {
        replacement = [0xa1, 0xc1]; // 全角チルダ -> 波ダッシュ
      } else if (convertsNumeroSign && str[i + 2] === 0xf1) {
        replacement = [0xad, 0xe2]; // 全角NO -> 全角NO
      }
    }

    if (replacement) {
      // 3バイトを2バイトに置き換えるため、変換後は元の長さを超えない
      converted ??= Buffer.allocUnsafe(str.length);

      writePos += str.copy(converted, writePos, copiedPos, i);
      converted[writePos++] = replacement[0];
      converted[writePos++] = replacement[1];
      copiedPos = i + 3;
      i = str.indexOf(SS3, copiedPos);
    } else {
      i = str.indexOf(SS3, i + 1);
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
  const format = config.get<string>("statusBarFormat") as string;

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
  // これ以降の保存は起きないため、dirtyなものも変換する(第2引数)
  for (const key of [...pendingConversions.keys()]) {
    flushPendingConversion(key, true);
  }

  if (statusBarItem) {
    statusBarItem.dispose();
  }
}
