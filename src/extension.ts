import * as vscode from "vscode";
import * as fs from "fs";

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

// デバウンス中のステータスバー更新タイマー
let statusBarUpdateTimer: ReturnType<typeof setTimeout> | undefined;

// 保存済みで変換待ちのドキュメント(キー: ドキュメントのURI文字列)
// timerがundefinedのものは「ドキュメントがdirtyだったため変換を先送りした」状態で、
// 次の保存・クローズ・deactivateのいずれかのタイミングで変換される
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
      // タブが閉じられて、対象URIのタブが1つも無くなったドキュメントの
      // 変換待ちをフラッシュする。タブの開閉に確実に追従するイベントのため、
      // こちらを主な発火源とする(詳細はflushPendingConversionsWithoutOpenTabを参照)
      vscode.window.tabGroups.onDidChangeTabs(() => {
        flushPendingConversionsWithoutOpenTab();
      }),
      // 変換待ちのままドキュメントが破棄された場合は、その場で変換する
      // (取りこぼしの保険。このイベントはタブを閉じた時に発火する保証が
      // ないため、上記のtabGroups.onDidChangeTabsを主な発火源としている)
      vscode.workspace.onDidCloseTextDocument((document) => {
        flushPendingConversion(document.uri.toString());
      }),
      // アクティブファイルが変更された時や文字が変更された時に、ステータスバーの表示を更新する
      vscode.window.onDidChangeActiveTextEditor(() => {
        // エディタが切り替わったので、直前のエディタ向けにスケジュールされていた更新は不要
        cancelScheduledStatusBarUpdate();
        updateStatusBarItem(statusBarItem);
      }),
      vscode.workspace.onDidChangeTextDocument((e) => {
        // アクティブエディタ以外のドキュメント変更(出力チャンネルなど)では
        // ステータスバーの表示に影響がないため、更新をスキップする
        if (e.document !== vscode.window.activeTextEditor?.document) {
          return;
        }

        // 連続するキーストロークのたびに全文スキャンが走らないように、更新をデバウンスする
        scheduleStatusBarUpdate(statusBarItem);
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

  // 変換対象文字がドキュメントに1つもなければ、ディスクを読みに行く必要すらない
  // 保存直後のドキュメントテキストが保存内容の真実源であるため、これで安全に判定できる
  if (!containsConvertTargetCharacters(document.getText())) {
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
 * ドキュメントがdirty(未保存の編集がある)の場合は変換しない。
 * ここでファイルを書き換えると、その後の保存が「上書きに失敗しました」になるため、
 * 変換待ちのまま保留し、次の保存・クローズ・deactivateのタイミングに委ねる
 *
 * @param key pendingConversionsのキー(ドキュメントのURI文字列)
 * @param document 変換対象のドキュメント
 */
function runScheduledConversion(key: string, document: vscode.TextDocument) {
  if (!document.isClosed && document.isDirty) {
    // 変換待ちの印だけを残して先送りする(timer: undefined)
    pendingConversions.set(key, { document, timer: undefined });
    return;
  }

  pendingConversions.delete(key);

  const written = document.isClosed
    ? convertSavedFile(document.fileName)
    : replaceSpecificCharacters(document);

  if (written && !document.isClosed) {
    syncEditorWithConvertedFile(document);
  }
}

/**
 * pendingConversionsのうち、対応するタブが1つも開かれていないものをその場で変換する
 *
 * onDidCloseTextDocumentは「ドキュメントが破棄された時」に発火するイベントであり、
 * VS CodeのAPIドキュメントにも「タブを閉じた時に発火する保証はない」と明記されている。
 * 実際、このイベントに変換のフラッシュを紐付けていた実装では、タブを閉じても
 * ドキュメントが破棄されるまで(VS Codeを終了するまで)変換待ちのまま残ることがあった。
 *
 * tabGroups.onDidChangeTabsはタブの開閉に確実に追従するため、こちらを主な
 * 発火源とする。ただし、まだ他のタブで開かれているドキュメントをここでフラッシュ
 * すると、dirtyな状態のままファイルを直接書き換えてしまいissue #13が再発するため、
 * 対象URIのタブが1つも無い場合に限ってフラッシュする
 */
function flushPendingConversionsWithoutOpenTab() {
  const openUris = new Set(
    vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .map((tab) => getTabUri(tab.input))
      .filter((uri): uri is vscode.Uri => uri !== undefined)
      .map((uri) => uri.toString()),
  );

  // flushPendingConversionが走査中にpendingConversionsをdeleteするため、
  // キーのスナップショットを取ってから回す
  for (const key of [...pendingConversions.keys()]) {
    if (!openUris.has(key)) {
      flushPendingConversion(key);
    }
  }
}

/**
 * タブの入力(Tab.input)が持つURIを取り出す
 *
 * Tab.inputの型はTabInputText | TabInputTextDiff | ... | unknownと非常に広いため、
 * 個々の型に対してinstanceof判定をするのではなく、uriプロパティを持つかどうかで
 * 安全に絞り込む(TabInputText, TabInputCustom, TabInputNotebookなどが対象になる)
 *
 * @param input タブの入力(Tab.input)
 * @returns URI。uriプロパティを持たない入力の場合はundefined
 */
function getTabUri(input: unknown): vscode.Uri | undefined {
  if (
    typeof input === "object" &&
    input !== null &&
    "uri" in input &&
    input.uri instanceof vscode.Uri
  ) {
    return input.uri;
  }

  return undefined;
}

/**
 * 変換待ちのドキュメントがあれば、その場で変換する
 *
 * flushPendingConversionsWithoutOpenTab、およびonDidCloseTextDocument
 * (取りこぼしの保険。詳細はactivate内のコメントを参照)から呼ばれる。
 * ここで変換する時点でドキュメントは既にタブから閉じられている(または破棄されている)ため、
 * 保存とは競合しない。エディタ上の編集が破棄されている可能性があるため、
 * ドキュメントのテキストは参照せずディスク上のファイルを直接変換する
 *
 * @param key pendingConversionsのキー(ドキュメントのURI文字列)
 */
function flushPendingConversion(key: string) {
  const pending = pendingConversions.get(key);
  if (!pending) {
    return;
  }

  if (pending.timer !== undefined) {
    clearTimeout(pending.timer);
  }
  pendingConversions.delete(key);

  convertSavedFile(pending.document.fileName);
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
 * revertコマンドはアクティブエディタにしか作用しないため、対象ドキュメントが
 * アクティブでない場合は何もしない(その場合はVS Codeのファイルウォッチャーに
 * よる自動再読込に委ねる)
 *
 * @param document 変換したファイルのドキュメント
 */
async function syncEditorWithConvertedFile(document: vscode.TextDocument) {
  // dirtyなドキュメントをrevertすると編集内容が失われるため、
  // アクティブエディタが対象ドキュメントかつdirtyでない場合のみ実行する
  const activeDocument = vscode.window.activeTextEditor?.document;
  if (activeDocument !== document || document.isDirty) {
    return;
  }

  try {
    await vscode.commands.executeCommand("workbench.action.files.revert");
  } catch {
    // revertに失敗しても、ファイルウォッチャーによる自動再読込で追従されるため無視する
  }
}

/**
 * ドキュメントの文字列に変換対象文字(全角チルダ、全角NO)が含まれるかを判定する
 *
 * 設定で変換が無効化されている文字は判定対象に含めない
 * (例: fullwidthTildeToWaveDashがfalseなら全角チルダの有無は見ない)
 *
 * @param text 判定対象の文字列(保存直後のドキュメント全文を想定)
 * @returns `true`: 変換対象文字が1つ以上含まれる, `false`: 含まれない
 */
function containsConvertTargetCharacters(text: string): boolean {
  const config = vscode.workspace.getConfiguration("waveDashUnify");

  const convertsFullwidthTilde = config.get(
    "fullwidthTildeToWaveDash",
  ) as boolean;
  const convertsNumeroSign = config.get("numeroSignToNumeroSign") as boolean;

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

/**
 * ステータスバーの更新をデバウンスする
 *
 * 短時間に連続して呼び出された場合、直近の呼び出しからSTATUS_BAR_UPDATE_DEBOUNCE_MSだけ
 * 経過した時点で1回だけupdateStatusBarItemを実行する(trailing edge)
 * 大きなファイルを編集中に1キーストロークごとの全文スキャンが走るのを防ぐ
 *
 * @param statusBarItem ステータスバーに表示する項目
 */
function scheduleStatusBarUpdate(statusBarItem: vscode.StatusBarItem) {
  cancelScheduledStatusBarUpdate();

  statusBarUpdateTimer = setTimeout(() => {
    statusBarUpdateTimer = undefined;
    updateStatusBarItem(statusBarItem);
  }, STATUS_BAR_UPDATE_DEBOUNCE_MS);
}

/**
 * scheduleStatusBarUpdateでスケジュールされた、未実行のステータスバー更新をキャンセルする
 */
function cancelScheduledStatusBarUpdate() {
  if (statusBarUpdateTimer !== undefined) {
    clearTimeout(statusBarUpdateTimer);
    statusBarUpdateTimer = undefined;
  }
}

export function deactivate() {
  cancelScheduledStatusBarUpdate();

  // 変換待ちのファイルを残さないように、終了前にすべて変換する
  for (const [key, pending] of pendingConversions) {
    if (pending.timer !== undefined) {
      clearTimeout(pending.timer);
    }
    pendingConversions.delete(key);

    convertSavedFile(pending.document.fileName);
  }

  if (statusBarItem) {
    statusBarItem.dispose();
  }
}
