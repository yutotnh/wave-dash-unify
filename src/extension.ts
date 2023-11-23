import * as vscode from "vscode";
import * as fs from "fs";
import * as encoding from "encoding-japanese";

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  // ファイルを保存した時に、EUC-JPのファイルの全角チルダを波ダッシュに変換する
  const disposable = vscode.workspace.onDidSaveTextDocument((document) => {
    replaceFullWidthTildeToWaveDash(document.fileName);
  });

  // アクティブファイルが変更された時や文字が変更された時に、ステータスバーの表示を更新する
  vscode.window.onDidChangeActiveTextEditor(() => {
    updateStatusBarItem(statusBarItem);
  });
  vscode.workspace.onDidChangeTextDocument(() => {
    updateStatusBarItem(statusBarItem);
  });

  context.subscriptions.push(disposable);

  setupStatusBarItem();
}

/**
 * 与えられた文字列中の全角チルダ(0x8F 0xA2 0xB7)を波ダッシュ(0xA1 0xC1)に変換する
 *
 * @param filePath 変換対象のファイルのパス
 * @returns 変換後の文字列
 */
export function replaceFullWidthTildeToWaveDash(filePath: string) {
  if (!isEnabled()) {
    return;
  }

  const content = fs.readFileSync(filePath);

  if (!isEUCJP(content)) {
    return;
  }

  const convertedString = replaceFullWidthTildeToWaveDashInBuffer(content);

  // 既にファイルを保存しているため、変換後の文字列と変換前の文字列が同じなら何もしない
  // これをしないと、Ctrl+Sを押しっぱなしにしたときに、上書きできなかったとエラーが出てくる
  // TODO 全角チルダを波ダッシュに変換した際も前述のエラーを出さないようにしたい
  if (Buffer.compare(convertedString, content) === 0) {
    return;
  }

  fs.writeFileSync(filePath, convertedString, { flag: "w" });
}

/**
 * 拡張機能の動作設定(ID: waveDashUnify.enable)の値を返す
 *
 * @returns `true`: 拡張機能の動作が有効, `false`: 拡張機能の動作が無効
 */
export function isEnabled(): boolean {
  const config = vscode.workspace.getConfiguration("waveDashUnify");

  return config.get("enable") as boolean;
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
 * 与えられた文字列中の全角チルダ(0x8F 0xA2 0xB7)を波ダッシュ(0xA1 0xC1)に変換する
 *
 * @param str 変換したい文字列
 * @returns 変換後の文字列
 */
export function replaceFullWidthTildeToWaveDashInBuffer(str: Buffer): Buffer {
  const fullWidthTilde = Buffer.from([0x8f, 0xa2, 0xb7]);
  const waveDash = Buffer.from([0xa1, 0xc1]);

  const convertedString: number[] = new Array(str.length);
  let convertedStringIndex = 0;

  for (let i = 0; i < str.length; i++) {
    // 変換したい元の文字列が3byteなので、現在の1byteに加えて2byte以上先があるときだけ変換を行う
    if (
      i + fullWidthTilde.length - 1 < str.length &&
      Buffer.compare(
        str.slice(i, i + fullWidthTilde.length),
        fullWidthTilde,
      ) === 0
    ) {
      convertedString[convertedStringIndex++] = waveDash[0];
      convertedString[convertedStringIndex++] = waveDash[1];

      i += fullWidthTilde.length - 1;
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
    100, // TODO この値は適当
  );

  statusBarItem.name = "waveDashUnify";

  updateStatusBarItem(statusBarItem);
}

/**
 * 全角チルダと波ダッシュの個数を数える
 * @param str 文字列
 * @returns 全角チルダと波ダッシュの個数
 */
export function countFullWidthTildeAndWaveDash(str: string): number {
  const waveDashCodePoint = 0x301c;
  const fullWidthTildeCodePoint = 0xff5e;

  let count = 0;
  for (let i = 0; i < str.length; i++) {
    if (
      str.codePointAt(i) === waveDashCodePoint ||
      str.codePointAt(i) === fullWidthTildeCodePoint
    ) {
      count++;
    }
  }

  return count;
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
  if (isEnabled()) {
    tooltip = "Wave Dash Unify is enabled";
  } else {
    tooltip = "Wave Dash Unify is disabled";
  }

  statusBarItem.tooltip = tooltip;

  const count = countFullWidthTildeAndWaveDash(
    vscode.window.activeTextEditor?.document.getText() ?? "",
  );

  statusBarItem.text = `${
    isEnabled() ? "$(pass)" : "$(error)"
  }: 全角チルダ・波ダッシュ: ${count}`;
}
