import * as vscode from "vscode";
import * as fs from "fs";
import * as encoding from "encoding-japanese";

export const WAVEDASH_CODE_POINT = 0x301c;
export const FULLWIDTH_TILDE_CODE_POINT = 0xff5e;
export const NUMERO_SIGN_CODE_POINT = 0x2116;

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("waveDashUnify.enableConvert", async () => {
      await vscode.workspace
        .getConfiguration("waveDashUnify")
        .update("enableConvert", true, true);

      updateStatusBarItem(statusBarItem);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "waveDashUnify.disableConvert",
      async () => {
        await vscode.workspace
          .getConfiguration("waveDashUnify")
          .update("enableConvert", false, true);

        updateStatusBarItem(statusBarItem);
      },
    ),
  );

  // ファイルを保存した時に、EUC-JPのファイルの全角チルダを波ダッシュに変換する
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      replaceSpecificCharacters(document.fileName);
    }),
  );

  // アクティブファイルが変更された時や文字が変更された時に、ステータスバーの表示を更新する
  vscode.window.onDidChangeActiveTextEditor(() => {
    updateStatusBarItem(statusBarItem);
  });
  vscode.workspace.onDidChangeTextDocument(() => {
    updateStatusBarItem(statusBarItem);
  });
  vscode.workspace.onDidChangeConfiguration(() => {
    updateStatusBarItem(statusBarItem);
  });

  setupStatusBarItem();
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
  const fullwidthTilde = Buffer.from([0x8f, 0xa2, 0xb7]);
  const waveDash = Buffer.from([0xa1, 0xc1]);

  const numeroSign = Buffer.from([0x8f, 0xa2, 0xf1]);
  const numeroSignConverted = Buffer.from([0xad, 0xe2]);

  const convertedString: number[] = new Array(str.length);
  let convertedStringIndex = 0;

  for (let i = 0; i < str.length; i++) {
    // 変換したい元の文字列が3byteなので、現在の1byteに加えて2byte以上先があるときだけ変換を行う
    if (i + fullwidthTilde.length - 1 < str.length) {
      if (
        Buffer.compare(
          str.slice(i, i + fullwidthTilde.length),
          fullwidthTilde,
        ) === 0
      ) {
        for (let j = 0; j < waveDash.length; j++) {
          convertedString[convertedStringIndex++] = waveDash[j];
        }

        i += waveDash.length;
        continue;
      } else if (
        Buffer.compare(str.slice(i, i + numeroSign.length), numeroSign) === 0
      ) {
        for (let j = 0; j < numeroSignConverted.length; j++) {
          convertedString[convertedStringIndex++] = numeroSignConverted[j];
        }

        i += numeroSign.length;
        continue;
      }
    } else {
      convertedString[convertedStringIndex++] = str[i];
    }
  }

  return Buffer.from(convertedString.slice(0, convertedStringIndex));
}

/**
 * ステータスバーにWaveDashUnifyの状態を表示する
 */
export function setupStatusBarItem() {
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
  );

  statusBarItem.name = "Wave Dash Unify";

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
  let waveDashAndFullwidthTildeCount = 0;
  let numeroSignCount = 0;
  for (let i = 0; i < str.length; i++) {
    if (
      str.codePointAt(i) === WAVEDASH_CODE_POINT ||
      str.codePointAt(i) === FULLWIDTH_TILDE_CODE_POINT
    ) {
      waveDashAndFullwidthTildeCount++;
    }

    if (str.codePointAt(i) === NUMERO_SIGN_CODE_POINT) {
      numeroSignCount++;
    }
  }

  return {
    waveDashAndFullwidthTilde: waveDashAndFullwidthTildeCount,
    numeroSign: numeroSignCount,
  };
}

/**
 * ステータスバーに全角チルダを波ダッシュに変換する機能の有効/無効を表示する
 *
 * @param statusBarItem ステータスバーに表示する項目
 */
export function updateStatusBarItem(statusBarItem: vscode.StatusBarItem) {
  // アクティブなテキストエディタがファイルではない場合は
  // 全角チルダと波ダッシュの個数を表示しても意味がないので、
  // ステータスバーの表示領域のスペースを空けるために非表示にする
  if (!vscode.window.activeTextEditor) {
    statusBarItem.hide();
    return;
  }

  statusBarItem.show();

  let tooltip = "";

  // ステータスバーに表示するアイコンだと何を表しているのか伝わりにくいので、
  // ツールチップで有効/無効を説明する
  if (isConvertEnabled()) {
    tooltip = "Wave Dash Unify is enabled";
  } else {
    tooltip = "Wave Dash Unify is disabled";
  }

  statusBarItem.tooltip = tooltip;

  const count = countSpecificCharacters(
    vscode.window.activeTextEditor?.document.getText() ?? "",
  );

  statusBarItem.text = `${
    isConvertEnabled() ? "$(pass)" : "$(error)"
  } 全角チルダ・波ダッシュ: ${count.waveDashAndFullwidthTilde},	全角NO: ${count.numeroSign}`;
}
