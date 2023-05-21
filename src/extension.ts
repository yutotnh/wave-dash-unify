import * as vscode from "vscode";
import * as fs from "fs";

export function activate(context: vscode.ExtensionContext) {
	// ファイルを保存した時に、EUC-JPのファイルの全角チルダを波ダッシュに変換する
	vscode.workspace.onDidSaveTextDocument((document) => {
		const config = vscode.workspace.getConfiguration("waveDashUnify");
		if (!config.get("enable")) { return; }

		const filePath = document.uri.fsPath;

		const content = fs.readFileSync(filePath);

		if (!isEUCJP(content)) {
			return;
		}

		const convertedString = replaceFullWidthTildeToWaveDash(content);

		// 既にファイルを保存しているため、変換後の文字列と変換前の文字列が同じなら何もしない
		// これをしないと、Ctrl+Sを押しっぱなしにしたときに、上書きできなかったとエラーが出てくる
		// TODO 全角チルダを波ダッシュに変換した際も前述のエラーを出さないようにしたい
		if (Buffer.compare(convertedString, content) === 0) {
			return;
		}

		fs.writeFileSync(filePath, convertedString, { flag: "w" });
	});
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
 * @param str 変換元の文字列
 * @returns 変換後の文字列
 */
export function replaceFullWidthTildeToWaveDash(str: Buffer): Buffer {
	let convertedString: number[] = new Array(str.length);
	let convertedStringIndex = 0;
	for (let i = 0; i < str.length; i++) {
		if (i + 2 < str.length) {
			if (str[i] === 0x8F && str[i + 1] === 0xA2 && str[i + 2] === 0xB7) {
				convertedString[convertedStringIndex] = 0xA1;
				convertedString[convertedStringIndex + 1] = 0xC1;

				i += 2;
				convertedStringIndex += 2;
				continue;
			}
		}
		convertedString[convertedStringIndex++] = str[i];
	}

	return Buffer.from(convertedString.slice(0, convertedStringIndex));
}

// This method is called when your extension is deactivated
export function deactivate() { }
