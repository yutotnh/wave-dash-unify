import * as vscode from "vscode";
import * as fs from "fs";
import * as encoding from "encoding-japanese";

export const WAVEDASH_CODE_POINT = 0x301c;
export const FULLWIDTH_TILDE_CODE_POINT = 0xff5e;
export const NUMERO_SIGN_CODE_POINT = 0x2116;

let statusBarItem: vscode.StatusBarItem;

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
        replaceSpecificCharacters(document.fileName);
      }),
      // アクティブファイルが変更された時や文字が変更された時に、ステータスバーの表示を更新する
      vscode.window.onDidChangeActiveTextEditor(() => {
        updateStatusBarItem(statusBarItem);
      }),
      vscode.workspace.onDidChangeTextDocument(() => {
        updateStatusBarItem(statusBarItem);
      }),
      vscode.workspace.onDidChangeConfiguration(() => {
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
 * @param filePath 変換対象のファイルのパス
 * @returns 変換後の文字列
 */
export function replaceSpecificCharacters(filePath: string) {
  if (!isConvertEnabled()) {
    return;
  }

  const content = fs.readFileSync(filePath);

  if (!isEUCJP(content)) {
    return;
  }

  const convertedString = replaceSpecificCharactersInBuffer(content);

  // 既にファイルを保存しているため、変換後の文字列と変換前の文字列が同じなら何もしない
  // これをしないと、Ctrl+Sを押しっぱなしにしたときに、上書きできなかったとエラーが出てくる
  // TODO 全角チルダを波ダッシュに変換した際も前述のエラーを出さないようにしたい
  if (Buffer.compare(convertedString, content) === 0) {
    return;
  }

  fs.writeFileSync(filePath, convertedString, { flag: "w" });
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
 * ASCIIのみのファイルもEUC-JPと判定される
 *
 * @param str 判定する文字列
 * @returns `true`: EUC-JP, `false`: EUC-JP以外
 */
export function isEUCJP(str: Buffer): boolean {
  return encoding.detect(str, "EUCJP") === "EUCJP";
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

  const replacements: { [key: string]: Buffer } = {};

  if (config.get("fullwidthTildeToWaveDash")) {
    replacements["8fa2b7"] = Buffer.from([0xa1, 0xc1]); // 全角チルダ -> 波ダッシュ
  }

  if (config.get("numeroSignToNumeroSign")) {
    replacements["8fa2f1"] = Buffer.from([0xad, 0xe2]); // 全角NO -> 全角NO
  }

  const convertedString: number[] = [];
  let i = 0;

  while (i < str.length) {
    let replaced = false;

    for (const [key, value] of Object.entries(replacements)) {
      const keyBuffer = Buffer.from(key, "hex");

      if (str.subarray(i, i + keyBuffer.length).equals(keyBuffer)) {
        convertedString.push(...value);
        i += keyBuffer.length;
        replaced = true;
        break;
      }
    }

    if (!replaced) {
      convertedString.push(str[i]);
      i++;
    }
  }

  return Buffer.from(convertedString);
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
  const counts = {
    waveDashAndFullwidthTilde: 0,
    numeroSign: 0,
  };

  for (const char of str) {
    const codePoint = char.codePointAt(0);
    if (
      codePoint === WAVEDASH_CODE_POINT ||
      codePoint === FULLWIDTH_TILDE_CODE_POINT
    ) {
      counts.waveDashAndFullwidthTilde++;
    } else if (codePoint === NUMERO_SIGN_CODE_POINT) {
      counts.numeroSign++;
    }
  }

  return counts;
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
  if (statusBarItem) {
    statusBarItem.dispose();
  }
}
