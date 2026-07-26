import * as assert from "assert";
import * as extension from "../../extension";
import * as fs from "fs";
import * as tmp from "tmp";

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from "vscode";

suite("Extension Test Suite", () => {
  vscode.window.showInformationMessage("Start all tests.");

  test("Cleanup", async () => {
    // テスト後にファイルを削除する
    tmp.setGracefulCleanup();

    // 設定をリセットする
    const config = vscode.workspace.getConfiguration("waveDashUnify");
    const settings = [
      "enableConvert",
      "fullwidthTildeToWaveDash",
      "numeroSignToNumeroSign",
      "statusBarFormat",
    ];

    await Promise.all(
      settings.map((setting) =>
        config.update(setting, undefined, vscode.ConfigurationTarget.Global),
      ),
    );
  });

  /**
   * 統合テスト
   */
  test("Integration test", async () => {
    /**
     * ファイルの内容が期待値になるまでポーリングで待つ
     *
     * 保存後の変換はデバウンスされて非同期に実行されるため、
     * 保存直後にファイルを読んでも変換前の内容が返ることがある
     *
     * @param path 読み込むファイルのパス
     * @param expected 期待するファイル内容
     * @param timeoutMs 待機の上限時間(ms)
     * @returns 最後に読み込んだファイル内容(タイムアウト時は期待値と異なる内容)
     */
    async function waitForFileContent(
      path: string,
      expected: Buffer,
      timeoutMs: number,
    ): Promise<Buffer> {
      const deadline = Date.now() + timeoutMs;

      let actual = fs.readFileSync(path);
      while (Date.now() < deadline && Buffer.compare(actual, expected) !== 0) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        actual = fs.readFileSync(path);
      }

      return actual;
    }

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

      if (!enableConvert) {
        // 変換が無効の場合は「変換されないこと」の確認なので、
        // 変換が誤ってスケジュールされていれば実行されているはずの時間まで待つ
        await new Promise((resolve) =>
          setTimeout(resolve, extension.SAVE_CONVERSION_DEBOUNCE_MS * 2 + 100),
        );
      }

      // 保存後の変換はデバウンスされて非同期に実行されるため、結果が確定するまで待つ
      const actual = await waitForFileContent(tmpFile.name, expect, 5000);

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
        insert: "～№",
        // 文字列: "～№ああああ"
        expect: Buffer.from([
          0xa1, 0xc1, 0xad, 0xe2, 0xa4, 0xa2, 0xa4, 0xa2, 0xa4, 0xa2, 0xa4,
          0xa2,
        ]),
      },
      {
        // 拡張機能が無効だとファイルが変化しないことの確認
        enableConvert: false,
        // 文字列: "ああああ"
        contents: Buffer.from([0xa4, 0xa2, 0xa4, 0xa2, 0xa4, 0xa2, 0xa4, 0xa2]),
        insert: "～№",
        // 文字列: "～№ああああ"
        expect: Buffer.from([
          0x8f, 0xa2, 0xb7, 0x8f, 0xa2, 0xf1, 0xa4, 0xa2, 0xa4, 0xa2, 0xa4,
          0xa2, 0xa4, 0xa2,
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
  test("detect EUC-JP", async () => {
    const eucjpDocument = await vscode.workspace.openTextDocument({
      content: "あ", // 文字列は何でも良い
      encoding: "eucjp",
    });
    assert.strictEqual(
      extension.isEUCJP(eucjpDocument),
      true,
      `document: ${eucjpDocument.getText()}`,
    );

    const notEucjpDocument = await vscode.workspace.openTextDocument({
      content: "い", // 文字列は何でも良い
      encoding: "utf8",
    });
    assert.strictEqual(
      extension.isEUCJP(notEucjpDocument),
      false,
      `document: ${notEucjpDocument.getText()}`,
    );
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
          .replaceSpecificCharactersInBuffer(content.before)
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
    const contents = [
      // 全角チルダのみ
      // 文字列: "～"
      {
        string: String.fromCodePoint(extension.FULLWIDTH_TILDE_CODE_POINT),
        count: 1,
      },
      // 文字列: "～～"
      {
        string: String.fromCodePoint(
          extension.FULLWIDTH_TILDE_CODE_POINT,
        ).repeat(2),
        count: 2,
      },
      // 全角チルダの前後にASCII文字
      // 文字列: "1～～2"
      {
        string:
          "1" +
          String.fromCodePoint(extension.FULLWIDTH_TILDE_CODE_POINT).repeat(2) +
          "2",
        count: 2,
      },
      // 波ダッシュのみ
      // 文字列: "～"
      {
        string: String.fromCodePoint(extension.WAVEDASH_CODE_POINT),
        count: 1,
      },
      // 文字列: "～～"
      {
        string: String.fromCodePoint(extension.WAVEDASH_CODE_POINT).repeat(2),
        count: 2,
      },
      // 波ダッシュの前後にASCII文字
      // 文字列: "1～～2"
      {
        string:
          "1" +
          String.fromCodePoint(extension.WAVEDASH_CODE_POINT).repeat(2) +
          "2",
        count: 2,
      },
      // 全角チルダと波ダッシュの混在
      // 文字列: "～～～～"
      {
        string:
          String.fromCodePoint(extension.FULLWIDTH_TILDE_CODE_POINT).repeat(2) +
          String.fromCodePoint(extension.WAVEDASH_CODE_POINT).repeat(2),
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
        extension.countSpecificCharacters(content.string)
          .waveDashAndFullwidthTilde,
        content.count,
        `content: ${content.string}`,
      );
    });
  });

  /**
   * 全角NOに変換する関数をテストする
   */
  test("replace numero sigh", () => {
    const contents = [
      // 全角NOのみ
      // 文字列: "№"
      {
        before: Buffer.from([0x8f, 0xa2, 0xf1]),
        after: Buffer.from([0xad, 0xe2]),
      },
      // 文字列: "№№"
      {
        before: Buffer.from([0x8f, 0xa2, 0xf1, 0x8f, 0xa2, 0xf1]),
        after: Buffer.from([0xad, 0xe2, 0xad, 0xe2]),
      },

      // 全角NOの前後にASCII文字
      // 文字列: "1№№2"
      {
        before: Buffer.from([0x31, 0x8f, 0xa2, 0xf1, 0x8f, 0xa2, 0xf1, 0x32]),
        after: Buffer.from([0x31, 0xad, 0xe2, 0xad, 0xe2, 0x32]),
      },

      // 全角NOを含まないECU-JPの文字列
      // 文字列: "あ"
      {
        before: Buffer.from([0xa4, 0xa2]),
        after: Buffer.from([0xa4, 0xa2]),
      },
    ];

    contents.forEach((content) => {
      assert.strictEqual(
        extension
          .replaceSpecificCharactersInBuffer(content.before)
          .toString("hex"),
        content.after.toString("hex"),
        `content: ${content.before.toString("hex")}`,
      );
    });
  });

  /**
   * 全角NOの個数をカウントする関数をテストする
   */
  test("count numero sign", () => {
    const contents = [
      // 全角NOのみ
      // 文字列: "№"
      {
        string: String.fromCodePoint(extension.NUMERO_SIGN_CODE_POINT),
        count: 1,
      },
      // 文字列: "№№"
      {
        string: String.fromCodePoint(extension.NUMERO_SIGN_CODE_POINT).repeat(
          2,
        ),
        count: 2,
      },
      // 全角NOの前後にASCII文字
      // 文字列: "1№№2"
      {
        string:
          "1" +
          String.fromCodePoint(extension.NUMERO_SIGN_CODE_POINT).repeat(2) +
          "2",
        count: 2,
      },
      // 文字列: "№№"
      {
        string: String.fromCodePoint(extension.NUMERO_SIGN_CODE_POINT).repeat(
          2,
        ),
        count: 2,
      },
      // 全角NOがない文字列
      // 文字列: "あ"
      {
        string: "あ",
        count: 0,
      },
    ];

    contents.forEach((content) => {
      assert.strictEqual(
        extension.countSpecificCharacters(content.string).numeroSign,
        content.count,
        `content: ${content.string}`,
      );
    });
  });

  /**
   * すべての対象文字を含む文字列で、変換する関数をテストする
   */
  test("replace all target characters", () => {
    const contents = [
      // 文字列: "～№～"
      {
        before: Buffer.from([
          0x8f, 0xa2, 0xb7, 0x8f, 0xa2, 0xf1, 0x8f, 0xa2, 0xb7,
        ]),
        after: Buffer.from([0xa1, 0xc1, 0xad, 0xe2, 0xa1, 0xc1]),
      },
    ];

    contents.forEach((content) => {
      assert.strictEqual(
        extension
          .replaceSpecificCharactersInBuffer(content.before)
          .toString("hex"),
        content.after.toString("hex"),
        `content: ${content.before.toString("hex")}`,
      );
    });
  });

  /**
   * すべての対象文字を含む文字列で、個数をカウントする関数をテストする
   */
  test("count all target characters", () => {
    const contents = [
      // 文字列: "№№"
      {
        string:
          String.fromCodePoint(extension.NUMERO_SIGN_CODE_POINT).repeat(1) +
          String.fromCodePoint(extension.WAVEDASH_CODE_POINT).repeat(2) +
          String.fromCodePoint(extension.NUMERO_SIGN_CODE_POINT).repeat(4) +
          String.fromCodePoint(extension.FULLWIDTH_TILDE_CODE_POINT).repeat(8),
        count: { waveDashAndFullwidthTilde: 10, numeroSign: 5 },
      },
    ];

    contents.forEach((content) => {
      assert.deepStrictEqual(
        extension.countSpecificCharacters(content.string),
        content.count,
        `content: ${content.string}`,
      );
    });
  });

  /**
   * 設定のtrue/falseによって、全角チルダを波ダッシュに変換する機能の有効/無効を切り替える関数をテストする
   *
   * replaceSpecificCharactersInBufferにはwaveDashUnify.enableConvertの設定値が反映されないため、
   * このテストではreplaceSpecificCharactersInBufferによる変換結果への影響を確認しない
   *
   * waveDashUnify.enableConvertの設定値の影響確認は、統合テストで行う
   */
  test("config enable/disable convert", async () => {
    const config = vscode.workspace.getConfiguration("waveDashUnify");
    // ～№
    const contents = Buffer.from([0x8f, 0xa2, 0xb7, 0x8f, 0xa2, 0xf1]);

    async function configuration(
      fullwidthTildeToWaveDash: boolean,
      numeroSignToNumeroSign: boolean,
    ) {
      await config.update(
        "fullwidthTildeToWaveDash",
        fullwidthTildeToWaveDash,
        vscode.ConfigurationTarget.Global,
      );

      await config.update(
        "numeroSignToNumeroSign",
        numeroSignToNumeroSign,
        vscode.ConfigurationTarget.Global,
      );
    }

    await configuration(true, true);
    assert.strictEqual(
      extension.replaceSpecificCharactersInBuffer(contents).toString("hex"),
      Buffer.from([0xa1, 0xc1, 0xad, 0xe2]).toString("hex"),
      "enableConvert: true, fullwidthTildeToWaveDash: true, numeroSignToNumeroSign: true",
    );

    await configuration(true, false);
    assert.strictEqual(
      extension.replaceSpecificCharactersInBuffer(contents).toString("hex"),
      Buffer.from([0xa1, 0xc1, 0x8f, 0xa2, 0xf1]).toString("hex"),
      "enableConvert: true, fullwidthTildeToWaveDash: true, numeroSignToNumeroSign: false",
    );

    await configuration(false, true);
    assert.strictEqual(
      extension.replaceSpecificCharactersInBuffer(contents).toString("hex"),
      Buffer.from([0x8f, 0xa2, 0xb7, 0xad, 0xe2]).toString("hex"),
      "enableConvert: true, fullwidthTildeToWaveDash: false, numeroSignToNumeroSign: true",
    );

    await configuration(false, false);
    assert.strictEqual(
      extension.replaceSpecificCharactersInBuffer(contents).toString("hex"),
      contents.toString("hex"),
      "enableConvert: true, fullwidthTildeToWaveDash: false, numeroSignToNumeroSign: false",
    );
  });

  /**
   * containsConvertTargetCharactersによる早期returnがEUC-JPファイルを保存しても
   * 内容を変えないことを検証するための共通ヘルパー
   *
   * ファイルを開いた直後はdirtyでないため、TextDocument.save()を呼んでも
   * 何も起きず(実際の保存もonDidSaveTextDocumentの発火もされない)、保存経路を
   * 検証したことにならない。末尾に1文字挿入してすぐ削除することで、内容は
   * 変えずにdirty→cleanの実際の保存を発生させてからファイルの内容を比較する
   *
   * ファイルの内容比較(保存経路)に加えて、containsConvertTargetCharacters自体の
   * 戻り値もfalseであることを直接確認する。replaceSpecificCharactersInBufferは
   * 変換対象の文字ごとに設定を再確認する独立したガードを持つため、
   * containsConvertTargetCharacters側の設定判定だけが壊れても保存結果の比較だけでは
   * 検出できない場合がある(実際に確認済み)。戻り値を直接見ることでその抜け穴を塞ぐ
   *
   * @param contents 保存対象のファイルの内容(変換が起きないことを期待する内容)
   * @param fullwidthTildeToWaveDash waveDashUnify.fullwidthTildeToWaveDashの設定値
   * @param numeroSignToNumeroSign waveDashUnify.numeroSignToNumeroSignの設定値
   * @param message アサーション失敗時のメッセージ
   */
  async function assertSaveLeavesFileUnchanged(
    contents: Buffer,
    fullwidthTildeToWaveDash: boolean,
    numeroSignToNumeroSign: boolean,
    message: string,
  ) {
    const waveDashUnifyConfig =
      vscode.workspace.getConfiguration("waveDashUnify");
    await waveDashUnifyConfig.update(
      "enableConvert",
      true,
      vscode.ConfigurationTarget.Global,
    );
    await waveDashUnifyConfig.update(
      "fullwidthTildeToWaveDash",
      fullwidthTildeToWaveDash,
      vscode.ConfigurationTarget.Global,
    );
    await waveDashUnifyConfig.update(
      "numeroSignToNumeroSign",
      numeroSignToNumeroSign,
      vscode.ConfigurationTarget.Global,
    );

    // 自動判定でEUC-JPと判定されるようにする
    const fileConfig = vscode.workspace.getConfiguration("files");
    await fileConfig.update(
      "autoGuessEncoding",
      true,
      vscode.ConfigurationTarget.Global,
    );

    const tmpFile = tmp.fileSync();
    fs.writeFileSync(tmpFile.name, contents);

    const document = await vscode.workspace.openTextDocument(tmpFile.name);
    const textEditor = await vscode.window.showTextDocument(document);
    assert.strictEqual(
      document.encoding,
      "eucjp",
      "前提条件エラー: ファイルがEUC-JPと判定されなかった",
    );

    assert.strictEqual(
      extension.containsConvertTargetCharacters(document),
      false,
      `containsConvertTargetCharactersがtrueを返した: ${message}`,
    );

    // dirty→cleanの実際の保存を発生させるため、末尾に1文字挿入してすぐ削除する
    // (内容自体は変えない)
    await textEditor.edit((editBuilder) => {
      const lastLine = document.lineCount - 1;
      const lastLineLength = document.lineAt(lastLine).text.length;
      editBuilder.insert(new vscode.Position(lastLine, lastLineLength), "x");
    });
    await textEditor.edit((editBuilder) => {
      const lastLine = document.lineCount - 1;
      const lastLineLength = document.lineAt(lastLine).text.length;
      editBuilder.delete(
        new vscode.Range(
          new vscode.Position(lastLine, lastLineLength - 1),
          new vscode.Position(lastLine, lastLineLength),
        ),
      );
    });
    await document.save();

    // 保存後の変換はデバウンスされるため、誤ってスケジュールされていれば
    // 実行されているはずの時間まで待ってから内容を確認する。document.save()の
    // 直後に読むと、変換がまだ実行されていないだけで「変化しなかった」と
    // 誤判定してしまい、この比較が実質的に何も検証しないことになる
    await new Promise((resolve) =>
      setTimeout(resolve, extension.SAVE_CONVERSION_DEBOUNCE_MS * 2 + 100),
    );

    const actual = fs.readFileSync(tmpFile.name);
    assert.strictEqual(
      actual.toString("hex"),
      contents.toString("hex"),
      message,
    );
  }

  /**
   * 変換対象文字がドキュメントに1つも無い場合、containsConvertTargetCharactersの
   * 早期returnによって保存経路がファイルの内容を一切変えないことを確認する
   */
  test("save EUC-JP file without target characters leaves it unchanged", async () => {
    // 変換対象文字を含まないEUC-JPの文字列
    // 文字列: "ああああ"
    const contents = Buffer.from([
      0xa4, 0xa2, 0xa4, 0xa2, 0xa4, 0xa2, 0xa4, 0xa2,
    ]);

    await assertSaveLeavesFileUnchanged(
      contents,
      true,
      true,
      "変換対象文字を含まないファイルが保存によって変化した",
    );
  });

  /**
   * fullwidthTildeToWaveDashとnumeroSignToNumeroSignの組み合わせによる
   * 早期returnの境界を確認する
   *
   * - fullwidthTildeToWaveDash: false, numeroSignToNumeroSign: true の状態で
   *   全角チルダのみを含むファイルを保存 → 変換されない
   * - fullwidthTildeToWaveDash: true, numeroSignToNumeroSign: false の状態で
   *   全角NOのみを含むファイルを保存 → 変換されない
   */
  test("early return respects each setting independently", async () => {
    // 全角チルダのみ(全角NOは含まない)
    // 文字列: "ああああ～"
    const fullwidthTildeOnly = Buffer.from([
      0xa4, 0xa2, 0xa4, 0xa2, 0xa4, 0xa2, 0xa4, 0xa2, 0x8f, 0xa2, 0xb7,
    ]);
    await assertSaveLeavesFileUnchanged(
      fullwidthTildeOnly,
      false,
      true,
      "fullwidthTildeToWaveDash: falseなのに、全角チルダのみのファイルが保存によって変化した",
    );

    // 全角NOのみ(全角チルダは含まない)
    // 文字列: "ああああ№"
    const numeroSignOnly = Buffer.from([
      0xa4, 0xa2, 0xa4, 0xa2, 0xa4, 0xa2, 0xa4, 0xa2, 0x8f, 0xa2, 0xf1,
    ]);
    await assertSaveLeavesFileUnchanged(
      numeroSignOnly,
      true,
      false,
      "numeroSignToNumeroSign: falseなのに、全角NOのみのファイルが保存によって変化した",
    );
  });

  /**
   * containsConvertTargetCharactersの早期returnが安全な理由を固定するテスト
   *
   * この判定はdocument.getText()に全角チルダ(U+FF5E)・全角NO(U+2116)が含まれるかで
   * 行うが、これは「保存直後のテキストが真実源だから」ではなく、EUC-JPで
   * 0x8F 0xA2 0xB7(全角チルダ)を生成できる文字がU+FF5E以外に無く、
   * 0x8F 0xA2 0xF1(全角NO)を生成できる文字もU+2116以外に無いためである。
   * つまりテキスト上の判定は「変換対象バイト列の有無」の安全側の過剰近似になる。
   *
   * この前提はVS Code自身のEUC-JPデコーダの実装に依存しており、それが変わると
   * 静かに壊れる(取りこぼしが発生する)ため、ここで固定しておく。
   * 変換後のバイト列(波ダッシュ0xA1 0xC1、全角NO 0xAD 0xE2)をデコードすると
   * それぞれU+FF5E・U+2116に戻ることも合わせて確認し、既に変換済みのファイルも
   * この判定に引っかかる(取りこぼされない)ことを保証する
   */
  test("already-converted bytes decode back to the target codepoints", async () => {
    const waveDashUnifyConfig =
      vscode.workspace.getConfiguration("waveDashUnify");
    await waveDashUnifyConfig.update(
      "fullwidthTildeToWaveDash",
      true,
      vscode.ConfigurationTarget.Global,
    );
    await waveDashUnifyConfig.update(
      "numeroSignToNumeroSign",
      true,
      vscode.ConfigurationTarget.Global,
    );

    // 自動判定でEUC-JPと判定されるようにする
    const fileConfig = vscode.workspace.getConfiguration("files");
    await fileConfig.update(
      "autoGuessEncoding",
      true,
      vscode.ConfigurationTarget.Global,
    );

    // 波ダッシュ(0xA1 0xC1)のみ。EUC-JPと自動認識されるよう"ああああ"を前置する
    // 文字列: "ああああ" + 波ダッシュ
    const waveDashFile = tmp.fileSync();
    fs.writeFileSync(
      waveDashFile.name,
      Buffer.from([0xa4, 0xa2, 0xa4, 0xa2, 0xa4, 0xa2, 0xa4, 0xa2, 0xa1, 0xc1]),
    );
    const waveDashDocument = await vscode.workspace.openTextDocument(
      waveDashFile.name,
    );
    assert.strictEqual(
      waveDashDocument.encoding,
      "eucjp",
      "前提条件エラー: ファイルがEUC-JPと判定されなかった",
    );
    assert.strictEqual(
      waveDashDocument
        .getText()
        .includes(String.fromCodePoint(extension.FULLWIDTH_TILDE_CODE_POINT)),
      true,
      "波ダッシュ(0xA1 0xC1)がU+FF5Eにデコードされなかった",
    );
    assert.strictEqual(
      extension.containsConvertTargetCharacters(waveDashDocument),
      true,
      "既に変換済みの波ダッシュが判定で取りこぼされた",
    );

    // 全角NO(0xAD 0xE2)のみ
    // 文字列: "ああああ" + 全角NO
    const numeroSignFile = tmp.fileSync();
    fs.writeFileSync(
      numeroSignFile.name,
      Buffer.from([0xa4, 0xa2, 0xa4, 0xa2, 0xa4, 0xa2, 0xa4, 0xa2, 0xad, 0xe2]),
    );
    const numeroSignDocument = await vscode.workspace.openTextDocument(
      numeroSignFile.name,
    );
    assert.strictEqual(
      numeroSignDocument.encoding,
      "eucjp",
      "前提条件エラー: ファイルがEUC-JPと判定されなかった",
    );
    assert.strictEqual(
      numeroSignDocument
        .getText()
        .includes(String.fromCodePoint(extension.NUMERO_SIGN_CODE_POINT)),
      true,
      "全角NO(0xAD 0xE2)がU+2116にデコードされなかった",
    );
    assert.strictEqual(
      extension.containsConvertTargetCharacters(numeroSignDocument),
      true,
      "既に変換済みの全角NOが判定で取りこぼされた",
    );
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

    // 拡張機能の動作設定(ID: waveDashUnify.enableConvert)がtrueのとき、先頭に"$(pass-filled)"が表示されることを確認する"
    await config.update(
      "enableConvert",
      true,
      vscode.ConfigurationTarget.Global,
    );

    extension.updateStatusBarItem(statusBarItem);

    const expectedEnableStatusIcon = "$(pass-filled)";
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
  test("count fullwidth tilde, wave dash, and numero sign in active text editor", async () => {
    const waveDashCount = 3;
    const fullwidthTildeCount = 2;
    const numeroSignCount = 4;

    // アクティブなテキストエディタを作り、そのテキストエディタのステータスバーに表示される項目を取得する
    const document = await vscode.workspace.openTextDocument({
      language: "plaintext",
      content:
        String.fromCodePoint(extension.FULLWIDTH_TILDE_CODE_POINT).repeat(
          fullwidthTildeCount,
        ) +
        String.fromCodePoint(extension.WAVEDASH_CODE_POINT).repeat(
          waveDashCount,
        ) +
        String.fromCodePoint(extension.NUMERO_SIGN_CODE_POINT).repeat(
          numeroSignCount,
        ),
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

    const expectedText = `$(pass-filled) ～: ${waveDashCount + fullwidthTildeCount}, №: ${numeroSignCount}`;
    // ステータスバーに表示される文字列が正しいことを確認する
    assert.strictEqual(
      statusBarItem.text,
      expectedText,
      "statusBarText: default",
    );

    // formatが空文字のとき、ステータスバーに表示されないことを確認する
    await config.update(
      "statusBarFormat",
      "",
      vscode.ConfigurationTarget.Global,
    );
    extension.updateStatusBarItem(statusBarItem);
    assert.strictEqual(statusBarItem.text, "", "statusBarFormat: empty");

    // formatが任意の文字列の時、ステータスバーに表示されることを確認する
    // 変数が無くても意図通りの表示されることを確認するために、statusBarIconは省略する
    await config.update(
      "statusBarFormat",
      "Wave Dash Unify: №(${numeroSignCount}) ～(${waveDashAndFullwidthTildeCount})",
      vscode.ConfigurationTarget.Global,
    );
    extension.updateStatusBarItem(statusBarItem);
    const expectedTextWithFormat = `Wave Dash Unify: №(${numeroSignCount}) ～(${waveDashCount + fullwidthTildeCount})`;
    assert.strictEqual(
      statusBarItem.text,
      expectedTextWithFormat,
      "statusBarFormat: custom",
    );

    vscode.window.showQuickPick(["OK"], {
      placeHolder: "Please check the status bar",
    });
  });

  // TODO ステータスバーのクリック時に実行されるコマンドのテストを行う
  // test("status bar item click", () => {
  // });
});
