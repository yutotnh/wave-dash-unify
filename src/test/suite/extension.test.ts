import * as assert from "assert";
import * as extension from "../../extension";
import * as fs from "fs";
import * as tmp from "tmp";

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from "vscode";
// import * as myExtension from '../../extension';

suite("Extension Test Suite", () => {
  vscode.window.showInformationMessage("Start all tests.");

  /**
   * 統合テスト
   */
  test("replace full-width tilde to wave dash 2", async () => {
    /**
     * 統合テスト
     */
    async function integrationTest(
      enable: boolean,
      contents: Buffer,
      expect: Buffer
    ) {
      // HACK 設定を意図的に有効にしないと、テストが失敗するため、設定を有効にする
      const config = vscode.workspace.getConfiguration("waveDashUnify");
      await config.update("enable", enable, vscode.ConfigurationTarget.Global);

      const tmpFile = tmp.fileSync();

      fs.writeFileSync(tmpFile.name, contents);

      extension.replaceFullWidthTildeToWaveDash(tmpFile.name);

      const actual = fs.readFileSync(tmpFile.name);

      assert.strictEqual(
        actual.toString("hex"),
        expect.toString("hex"),
        `content: ${actual.toString("hex")}`
      );
    }

    const testCase = [
      {
        enable: true,
        contents: Buffer.from([0x8f, 0xa2, 0xb7]),
        expect: Buffer.from([0xa1, 0xc1]),
      },
      {
        enable: true,
        contents: Buffer.from([0x8f, 0xa2, 0xb7, 0x8f, 0xa2, 0xb7]),
        expect: Buffer.from([0xa1, 0xc1, 0xa1, 0xc1, 0xa2, 0xb7]),
      },
      {
        enable: false,
        contents: Buffer.from([0x8f, 0xa2, 0xb7]),
        expect: Buffer.from([0x8f, 0xa2, 0xb7]),
      },
    ];

    testCase.forEach((test) => {
      integrationTest(test.enable, test.contents, test.expect);
    });
  });

  /**
   * 拡張機能の動作設定(ID: waveDashUnify.enable)の値を返す関数をテストする
   */
  test("isEnabled", async () => {
    const config = vscode.workspace.getConfiguration("waveDashUnify");

    // 拡張機能の動作設定(ID: waveDashUnify.enable)がtrueのとき
    await config.update("enable", true, vscode.ConfigurationTarget.Global);

    assert.strictEqual(extension.isEnabled(), true);

    // 拡張機能の動作設定(ID: waveDashUnify.enable)がfalseのとき
    await config.update("enable", false, vscode.ConfigurationTarget.Global);

    assert.strictEqual(extension.isEnabled(), false);
  });

  /**
   * 文字列がEUC-JPかを判定する関数をテストする
   */
  test("detect EUC-JP", () => {
    const eucjpContents = [
      // 全角チルダのみ
      Buffer.from([0x8f, 0xa2, 0xb7]),
      Buffer.from([0x8f, 0xa2, 0xb7, 0x8f, 0xa2, 0xb7]),

      // 全角チルダの前にASCII文字
      Buffer.from([0x31, 0x8f, 0xa2, 0xb7, 0x8f, 0xa2, 0xb7, 0x32]),
    ];

    eucjpContents.forEach((content) => {
      assert.strictEqual(
        extension.isEUCJP(content),
        true,
        `content: ${content.toString("hex")}`
      );
    });

    const notEucjpContents = [
      // ASCIIのみのテキストはEUC-JPと判断されるため、テストしない
      // 文字列: 123
      // Buffer.from([0x31, 0x32, 0x33]),

      // Shift-JISのテキスト
      // 文字列: こんにちは
      Buffer.from([0x82, 0xb1, 0x82, 0xf1, 0x82, 0xc9, 0x82, 0xbf, 0x82, 0xcd]),

      // UTF-8のテキスト
      // 文字列: よろしく
      Buffer.from([
        0xe3, 0x82, 0x88, 0xe3, 0x82, 0x8d, 0xe3, 0x81, 0x97, 0xe3, 0x81, 0x8f,
      ]),
    ];

    notEucjpContents.forEach((content) => {
      assert.strictEqual(
        extension.isEUCJP(content),
        false,
        `content: ${content.toString("hex")}`
      );
    });
  });

  /**
   * 全角チルダを波ダッシュに変換する関数をテストする
   */
  test("replace full-width tilde to wave dash", () => {
    const contents = [
      // 全角チルダのみ
      // 文字列: "～"
      {
        before: Buffer.from([0x8f, 0xa2, 0xb7]),
        after: Buffer.from([0xa1, 0xc1]),
      },
      // 文字列: "～～"
      {
        before: Buffer.from([0x8f, 0xa2, 0xb7, 0x8f, 0xa2, 0xb7]),
        after: Buffer.from([0xa1, 0xc1, 0xa1, 0xc1]),
      },

      // 全角チルダの前後にASCII文字
      // 文字列: "1～～2"
      {
        before: Buffer.from([0x31, 0x8f, 0xa2, 0xb7, 0x8f, 0xa2, 0xb7, 0x32]),
        after: Buffer.from([0x31, 0xa1, 0xc1, 0xa1, 0xc1, 0x32]),
      },

      // 全角チルダを含まないECU-JPの文字列
      // 文字列: "あ"
      {
        before: Buffer.from([0xa4, 0xa2]),
        after: Buffer.from([0xa4, 0xa2]),
      },
    ];

    contents.forEach((content) => {
      assert.strictEqual(
        extension
          .replaceFullWidthTildeToWaveDashInBuffer(content.before)
          .toString("hex"),
        content.after.toString("hex"),
        `content: ${content.before.toString("hex")}`
      );
    });
  });
});
