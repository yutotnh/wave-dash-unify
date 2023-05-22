import * as assert from 'assert';
import * as extension from '../../extension';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
// import * as myExtension from '../../extension';

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	/**
	 * 文字列がEUC-JPかを判定する関数をテストする
	 */
	test('detect EUC-JP', () => {
		const eucjpContents = [
			// 全角チルダのみ
			Buffer.from([0x8F, 0xA2, 0xB7]),
			Buffer.from([0x8F, 0xA2, 0xB7, 0x8F, 0xA2, 0xB7]),

			// 全角チルダの前にASCII文字
			Buffer.from([0x31, 0x8F, 0xA2, 0xB7, 0x8F, 0xA2, 0xB7, 0x32]),
		];

		eucjpContents.forEach(content => {
			assert.strictEqual(extension.isEUCJP(content), true, `content: ${content.toString('hex')}`);
		});

		const notEucjpContents = [
			// ASCIIのみのテキストはEUC-JPと判断されるため、テストしない
			// 文字列: 123
			// Buffer.from([0x31, 0x32, 0x33]),

			// Shift-JISのテキスト
			// 文字列: こんにちは
			Buffer.from([0x82, 0xB1, 0x82, 0xF1, 0x82, 0xC9, 0x82, 0xBF, 0x82, 0xCD]),

			// UTF-8のテキスト
			// 文字列: よろしく
			Buffer.from([0xE3, 0x82, 0x88, 0xE3, 0x82, 0x8D, 0xE3, 0x81, 0x97, 0xE3, 0x81, 0x8F]),
		];

		notEucjpContents.forEach(content => {
			assert.strictEqual(extension.isEUCJP(content), false, `content: ${content.toString('hex')}`);
		});
	});

	/**
	 * 全角チルダを波ダッシュに変換する関数をテストする
	 */
	test('replace full-width tilde to wave dash', () => {
		const contents = [
			// 全角チルダのみ
			// 文字列: "～"
			{
				before: Buffer.from([0x8F, 0xA2, 0xB7]),
				after: Buffer.from([0xA1, 0xC1]),
			},
			// 文字列: "～～"
			{
				before: Buffer.from([0x8F, 0xA2, 0xB7, 0x8F, 0xA2, 0xB7]),
				after: Buffer.from([0xA1, 0xC1, 0xA1, 0xC1]),
			},

			// 全角チルダの前後にASCII文字
			// 文字列: "1～～2"
			{
				before: Buffer.from([0x31, 0x8F, 0xA2, 0xB7, 0x8F, 0xA2, 0xB7, 0x32]),
				after: Buffer.from([0x31, 0xA1, 0xC1, 0xA1, 0xC1, 0x32]),
			},

			// 全角チルダを含まないECU-JPの文字列
			// 文字列: "あ"
			{
				before: Buffer.from([0xA4, 0xA2]),
				after: Buffer.from([0xA4, 0xA2])
			}
		];

		contents.forEach(content => {
			assert.strictEqual(
				extension.replaceFullWidthTildeToWaveDash(content.before).toString('hex'),
				content.after.toString('hex'),
				`content: ${content.before.toString('hex')}`
			);
		});
	});
});
