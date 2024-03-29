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
  test("Integration test", async () => {
    /**
     * VS Codeで実際にファイルを開いて保存する統合テスト
     *
     * @param enableConvert 拡張機能の動作設定(ID: waveDashUnify.enableConvert)の値
     * @param contents ファイルに書き込む内容
     * @param insert 挿入する文字列
     * @param expect ファイルに書き込まれた内容の期待値
     */
    async function integrationTest(
      enableConvert: boolean,
      contents: Buffer,
      insert: string,
      expect: Buffer,
    ) {
      const waveDashUnifyConfig =
        vscode.workspace.getConfiguration("waveDashUnify");
      await waveDashUnifyConfig.update(
        "enableConvert",
        enableConvert,
        vscode.ConfigurationTarget.Global,
      );

      const tmpFile = tmp.fileSync();

      fs.writeFileSync(tmpFile.name, contents);

      // 現在ファイルのエンコーディングを指定・変更する機能はないため、自動判定でEUC-JPと判定されるようにする
      const fileConfig = vscode.workspace.getConfiguration("files");
      await fileConfig.update(
        "autoGuessEncoding",
        true,
        vscode.ConfigurationTarget.Global,
      );

      // ファイル保存後にイベントが発火して、全角チルダが波ダッシュに変換されることを確認するために、
      // ファイルを開いて保存する
      const document = await vscode.workspace.openTextDocument(tmpFile.name);
      const textEditor = await vscode.window.showTextDocument(document);
      if (!textEditor) {
        // ファイルを開くのに失敗したらテストを失敗させる
        assert.fail();
      }

      await textEditor.edit((editBuilder: vscode.TextEditorEdit) => {
        editBuilder.insert(new vscode.Position(0, 0), insert);
      });
      await textEditor.document.save();

      const actual = fs.readFileSync(tmpFile.name);

      assert.strictEqual(
        actual.toString("hex"),
        expect.toString("hex"),
        `
        enableConvert: ${enableConvert}
        before: ${contents.toString("hex")}
        insert: ${insert}
        after :  ${actual.toString("hex")}`,
      );
    }

    const testCase = [
      {
        // EUC-JPと自動認識させるため、開くファイルを"ああああ"とした
        enableConvert: true,
        // 文字列: "ああああ"
        contents: Buffer.from([0xa4, 0xa2, 0xa4, 0xa2, 0xa4, 0xa2, 0xa4, 0xa2]),
        insert: "～",
        // 文字列: "～ああああ"
        expect: Buffer.from([
          0xa1, 0xc1, 0xa4, 0xa2, 0xa4, 0xa2, 0xa4, 0xa2, 0xa4, 0xa2,
        ]),
      },
      {
        // 拡張機能が無効だとファイルが変化しないことの確認
        enableConvert: false,
        // 文字列: "ああああ"
        contents: Buffer.from([0xa4, 0xa2, 0xa4, 0xa2, 0xa4, 0xa2, 0xa4, 0xa2]),
        insert: "～",
        // 文字列: "～ああああ"
        expect: Buffer.from([
          0x8f, 0xa2, 0xb7, 0xa4, 0xa2, 0xa4, 0xa2, 0xa4, 0xa2, 0xa4, 0xa2,
        ]),
      },
    ];

    for (const test of testCase) {
      await integrationTest(
        test.enableConvert,
        test.contents,
        test.insert,
        test.expect,
      );
    }
  });

  /**
   * 変換を有効にするコマンドをテストする
   */
  test("enable/disable convert", async () => {
    const config = vscode.workspace.getConfiguration("waveDashUnify");

    // enableのテストをするために、一度falseにする
    await config.update(
      "enableConvert",
      false,
      vscode.ConfigurationTarget.Global,
    );

    await vscode.commands.executeCommand("waveDashUnify.enableConvert");

    assert.strictEqual(extension.isConvertEnabled(), true);

    // 拡張機能の動作設定(ID: waveDashUnify.enableConvert)がtrueのとき

    await vscode.commands.executeCommand("waveDashUnify.disableConvert");

    assert.strictEqual(extension.isConvertEnabled(), false);
  });

  /**
   * 拡張機能の動作設定(ID: waveDashUnify.enableConvert)の値を返す関数をテストする
   */
  test("isEnabled", async () => {
    const config = vscode.workspace.getConfiguration("waveDashUnify");

    // 拡張機能の動作設定(ID: waveDashUnify.enableConvert)がtrueのとき
    await config.update(
      "enableConvert",
      true,
      vscode.ConfigurationTarget.Global,
    );

    assert.strictEqual(extension.isConvertEnabled(), true);

    // 拡張機能の動作設定(ID: waveDashUnify.enableConvert)がfalseのとき
    await config.update(
      "enableConvert",
      false,
      vscode.ConfigurationTarget.Global,
    );

    assert.strictEqual(extension.isConvertEnabled(), false);
  });

  /**
   * 文字列がEUC-JPかを判定する関数をテストする
   */
  test("detect EUC-JP", () => {
    const eucjpContents = [
      // 全角チルダのみ
      // 文字列: "～"
      Buffer.from([0x8f, 0xa2, 0xb7]),
      // 文字列: "～～"
      Buffer.from([0x8f, 0xa2, 0xb7, 0x8f, 0xa2, 0xb7]),

      // 全角チルダの前にASCII文字
      // 文字列: "1～～"
      Buffer.from([0xad, 0xa1]),

      // CP51932のテキスト
      // 文字列: 髙
      Buffer.from([0xfc, 0xe2, 0x0a]),

      // CP51932のテキスト
      // 文字列: ①
      Buffer.from([0xad, 0xa1]),
    ];

    eucjpContents.forEach((content) => {
      assert.strictEqual(
        extension.isEUCJP(content),
        true,
        `content: ${content.toString("hex")}`,
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
        `content: ${content.toString("hex")}`,
      );
    });
  });

  /**
   * 全角チルダを波ダッシュに変換する関数をテストする
   */
  test("replace fullwidth tilde to wave dash", () => {
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
          .replaceFullwidthTildeToWaveDashInBuffer(content.before)
          .toString("hex"),
        content.after.toString("hex"),
        `content: ${content.before.toString("hex")}`,
      );
    });
  });

  /**
   * 全角チルダと波ダッシュの個数をカウントする関数をテストする
   */
  test("count fullwidth tilde and wave dash", () => {
    const waveDashCodePoint = 0x301c;
    const fullwidthTildeCodePoint = 0xff5e;

    const contents = [
      // 全角チルダのみ
      // 文字列: "～"
      {
        string: String.fromCodePoint(fullwidthTildeCodePoint),
        count: 1,
      },
      // 文字列: "～～"
      {
        string: String.fromCodePoint(fullwidthTildeCodePoint).repeat(2),
        count: 2,
      },
      // 全角チルダの前後にASCII文字
      // 文字列: "1～～2"
      {
        string:
          "1" + String.fromCodePoint(fullwidthTildeCodePoint).repeat(2) + "2",
        count: 2,
      },
      // 波ダッシュのみ
      // 文字列: "～"
      {
        string: String.fromCodePoint(waveDashCodePoint),
        count: 1,
      },
      // 文字列: "～～"
      {
        string: String.fromCodePoint(waveDashCodePoint).repeat(2),
        count: 2,
      },
      // 波ダッシュの前後にASCII文字
      // 文字列: "1～～2"
      {
        string: "1" + String.fromCodePoint(waveDashCodePoint).repeat(2) + "2",
        count: 2,
      },
      // 全角チルダと波ダッシュの混在
      // 文字列: "～～～～"
      {
        string:
          String.fromCodePoint(fullwidthTildeCodePoint).repeat(2) +
          String.fromCodePoint(waveDashCodePoint).repeat(2),
        count: 4,
      },
      // 全角チルダと波ダッシュがない文字列
      // 文字列: "あ"
      {
        string: "あ",
        count: 0,
      },
    ];

    contents.forEach((content) => {
      assert.strictEqual(
        extension.countFullwidthTildeAndWaveDash(content.string),
        content.count,
        `content: ${content.string}`,
      );
    });
  });

  /**
   * ステータスバーの初期化を行う関数をテストする
   * NOTE: テスト対象のsetupStatusBarItem()はグローバル変数の初期化を行う関数なのでテストしない
   */

  /**
   * ステータスバーに全角チルダを波ダッシュに変換する機能の有効/無効を表示する関数をテストする
   */
  test("update status bar item", async () => {
    // アクティブなテキストエディタを作り、そのテキストエディタのステータスバーに表示される項目を取得する
    const document = await vscode.workspace.openTextDocument({
      language: "plaintext",
      content: "",
    });

    await vscode.window.showTextDocument(document);

    const statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
    );

    const config = vscode.workspace.getConfiguration("waveDashUnify");

    // 拡張機能の動作設定(ID: waveDashUnify.enableConvert)がtrueのとき、先頭に"$(pass)"が表示されることを確認する"
    await config.update(
      "enableConvert",
      true,
      vscode.ConfigurationTarget.Global,
    );

    extension.updateStatusBarItem(statusBarItem);

    const expectedEnableStatusIcon = "$(pass)";
    assert.strictEqual(
      statusBarItem.text.startsWith(expectedEnableStatusIcon),
      true,
      expectedEnableStatusIcon,
    );

    const expectedEnableStatusTooltip = "Wave Dash Unify is enabled";
    assert.strictEqual(statusBarItem.tooltip, expectedEnableStatusTooltip);

    // 拡張機能の動作設定(ID: waveDashUnify.enableConvert)がfalseのとき、先頭に"$(error)"が表示されることを確認する
    await config.update(
      "enableConvert",
      false,
      vscode.ConfigurationTarget.Global,
    );

    extension.updateStatusBarItem(statusBarItem);

    const expectedDisableStatusIcon = "$(error)";
    assert.strictEqual(
      statusBarItem.text.startsWith(expectedDisableStatusIcon),
      true,
      expectedDisableStatusIcon,
    );

    const expectedDisableStatusTooltip = "Wave Dash Unify is disabled";
    assert.strictEqual(statusBarItem.tooltip, expectedDisableStatusTooltip);
  });

  /**
   * アクティブなテキストエディタがファイルではない場合は、ステータスバーの表示領域のスペースを空けるために非表示にする関数をテストする
   * NOTE: StatusBarItem.show()とStatusBarItem.hide()を実行したことの確認はできないため、テストしない
   */

  /**
   * 全角チルダと波ダッシュの個数を数えた数がステータスバーに表示されることを確認する
   */
  test("count fullwidth tilde and wave dash in active text editor", async () => {
    const waveDashCodePoint = 0x301c;
    const fullwidthTildeCodePoint = 0xff5e;

    const waveDashCount = 3;
    const fullwidthTildeCount = 2;

    // アクティブなテキストエディタを作り、そのテキストエディタのステータスバーに表示される項目を取得する
    const document = await vscode.workspace.openTextDocument({
      language: "plaintext",
      content:
        String.fromCodePoint(fullwidthTildeCodePoint).repeat(
          fullwidthTildeCount,
        ) + String.fromCodePoint(waveDashCodePoint).repeat(waveDashCount),
    });

    await vscode.window.showTextDocument(document);

    const statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
    );

    // NOTE: このテストでは拡張機能の動作設定(ID: waveDashUnify.enableConvert)の値は関係ないが、
    //       ステータスバーに表示される文字列が正しいことを確認するために、
    //       拡張機能の動作設定(ID: waveDashUnify.enableConvert)の値をtrueにする
    const config = vscode.workspace.getConfiguration("waveDashUnify");
    await config.update(
      "enableConvert",
      true,
      vscode.ConfigurationTarget.Global,
    );

    extension.updateStatusBarItem(statusBarItem);

    const count = waveDashCount + fullwidthTildeCount;
    const expectedText = `$(pass) 全角チルダ・波ダッシュ: ${count}`;

    // ステータスバーに表示される文字列が正しいことを確認する
    assert.strictEqual(statusBarItem.text, expectedText);
  });
});
