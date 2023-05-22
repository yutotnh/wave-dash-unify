import * as vscode from "vscode";
import * as fs from "fs";

export function activate(context: vscode.ExtensionContext) {
	// ファイルを保存した時に、EUC-JPのファイルの全角チルダを波ダッシュに変換する
	vscode.workspace.onDidSaveTextDocument((document) => {
		if (!isEnabled()) { return; }

		const filePath = document.uri.fsPath;

		const content = fs.readFileSync(filePath);

		if (!isEUCJP(content)) { return; }

		const convertedString = replaceFullWidthTildeToWaveDash(content);

		// 既にファイルを保存しているため、変換後の文字列と変換前の文字列が同じなら何もしない
		// これをしないと、Ctrl+Sを押しっぱなしにしたときに、上書きできなかったとエラーが出てくる
		// TODO 全角チルダを波ダッシュに変換した際も前述のエラーを出さないようにしたい
		if (Buffer.compare(convertedString, content) === 0) { return; }

		fs.writeFileSync(filePath, convertedString, { flag: "w" });
	});
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
	const Encoding = require("encoding-japanese");

	return Encoding.detect(str, "EUCJP") === "EUCJP";
}

/**
 * 与えられた文字列中の全角チルダ(0x8F 0xA2 0xB7)を波ダッシュ(0xA1 0xC1)に変換する
 *
 * @param str 変換したい文字列
 * @returns 変換後の文字列
 */
export function replaceFullWidthTildeToWaveDash(str: Buffer): Buffer {
	const fullWidthTilde = Buffer.from([0x8F, 0xA2, 0xB7]);
	const waveDash = Buffer.from([0xA1, 0xC1]);

	let convertedString: number[] = new Array(str.length);
	let convertedStringIndex = 0;

	for (let i = 0; i < str.length; i++) {
		// 変換したい元の文字列が3byteなので、現在の1byteに加えて2byte以上先があるときだけ変換を行う
		if ((i + fullWidthTilde.length - 1 < str.length) &&
			(Buffer.compare(str.slice(i, i + fullWidthTilde.length), fullWidthTilde) === 0)) {

			convertedString[convertedStringIndex++] = waveDash[0];
			convertedString[convertedStringIndex++] = waveDash[1];

			i += fullWidthTilde.length - 1;
		} else {
			convertedString[convertedStringIndex++] = str[i];
		}
	}

	return Buffer.from(convertedString.slice(0, convertedStringIndex));
}

// This method is called when your extension is deactivated
export function deactivate() { }
