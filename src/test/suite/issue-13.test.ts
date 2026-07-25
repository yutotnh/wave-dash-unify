import * as assert from "assert";
import * as extension from "../../extension";
import * as fs from "fs";
import * as tmp from "tmp";
import * as vscode from "vscode";

/**
 * issue #13 の再現テスト
 * https://github.com/yutotnh/wave-dash-unify/issues/13
 *
 * 拡張機能は保存イベント(onDidSaveTextDocument)の中で fs.readFileSync / fs.writeFileSync を使い、
 * 既に保存済みのファイルを直接読み書きして全角チルダ等を波ダッシュに変換している。
 * この「保存後に追加でディスクを書き換える」処理により、VS Code が記録しているファイルの
 * mtime/etag とディスク上の実体がズレてしまう。
 *
 * この状態で短時間に何度も保存を行う(Ctrl+S を連打する等)と、VS Code が
 * 「ファイルの内容と一致しない」と判断し、TextDocument.save() が false を返す
 * (エディター上は「上書きに失敗しました」といったエラーになる)ことがある。
 *
 * 修正前の実装ではこのバグが再現する(=30回連続保存のうち1回でも
 * save() が false を返す)ことを、このテストで確認済み。
 *
 * 保存後の変換をデバウンスする修正により、連続保存中は拡張機能による
 * ファイル書き換えが発生しなくなったため、save() は常に true を返す。
 */
suite("Issue #13: 保存後のファイル書き換えによる連続保存の失敗", () => {
  test("issue #13: EUC-JPファイルに全角チルダが含まれる状態で高速に連続保存すると、save()がfalseを返すことなく全て成功する", async function () {
    this.timeout(60000);

    const waveDashUnifyConfig =
      vscode.workspace.getConfiguration("waveDashUnify");
    await waveDashUnifyConfig.update(
      "enableConvert",
      true,
      vscode.ConfigurationTarget.Global,
    );
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

    const tmpFile = tmp.fileSync();

    // EUC-JPと自動認識されるよう、繰り返しの多い日本語(「ああああ」)に全角チルダ(0x8F 0xA2 0xB7)を
    // 含めたファイルを用意する
    // 文字列: "ああああ～"
    const initialContent = Buffer.from([
      0xa4, 0xa2, 0xa4, 0xa2, 0xa4, 0xa2, 0xa4, 0xa2, 0x8f, 0xa2, 0xb7,
    ]);
    fs.writeFileSync(tmpFile.name, initialContent);

    const document = await vscode.workspace.openTextDocument(tmpFile.name);
    const textEditor = await vscode.window.showTextDocument(document);

    // テストの前提: ファイルがEUC-JPと判定されていること
    assert.strictEqual(
      document.encoding,
      "eucjp",
      "前提条件エラー: ファイルがEUC-JPと判定されなかった",
    );

    const ATTEMPTS = 30;
    const results: boolean[] = [];

    for (let i = 0; i < ATTEMPTS; i++) {
      // 保存の度に末尾へ1文字追記する(Ctrl+Sを連打しながら入力するイメージ)
      await textEditor.edit((editBuilder) => {
        const lastLine = document.lineCount - 1;
        const lastLineLength = document.lineAt(lastLine).text.length;
        editBuilder.insert(new vscode.Position(lastLine, lastLineLength), "a");
      });

      // 保存完了を待ってから次の保存に進む(シーケンシャルなCtrl+S連打)。
      // それでも issue #13 は再現する: 拡張機能が保存イベント後にfsで
      // ファイルを直接書き換えるため、VS Code側が記録するmtime/etagと
      // ディスク上の実体がズレ、次の保存でコンフリクトが起きる。
      results.push(await document.save());
    }

    const failedAttempts = results
      .map((succeeded, index) => ({ succeeded, attempt: index + 1 }))
      .filter(({ succeeded }) => !succeeded);

    // issue #13 の再現状況をログに残す
    console.log(
      `[issue-13] ${ATTEMPTS}回の連続保存中、${failedAttempts.length}回 save() が false を返した` +
        (failedAttempts.length > 0
          ? ` (失敗した試行: ${failedAttempts
              .map(({ attempt }) => attempt)
              .join(", ")}回目)`
          : ""),
    );

    // 修正後は、連続保存してもsave()が常にtrueを返すことを期待する
    assert.strictEqual(
      failedAttempts.length,
      0,
      `連続保存によりsave()がfalseを返した(issue #13が再現した): ${failedAttempts.length}/${ATTEMPTS}回失敗`,
    );

    // 保存が落ち着いた後、デバウンスされていた変換が実行されて
    // ディスク上の全角チルダ(0x8F 0xA2 0xB7)が波ダッシュ(0xA1 0xC1)に変換されることを確認する
    // 文字列: "ああああ～" + "a" * ATTEMPTS
    const expectedContent = Buffer.concat([
      Buffer.from([0xa4, 0xa2, 0xa4, 0xa2, 0xa4, 0xa2, 0xa4, 0xa2, 0xa1, 0xc1]),
      Buffer.from("a".repeat(ATTEMPTS)),
    ]);

    const deadline = Date.now() + 5000;
    let actualContent = fs.readFileSync(tmpFile.name);
    while (
      Date.now() < deadline &&
      Buffer.compare(actualContent, expectedContent) !== 0
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      actualContent = fs.readFileSync(tmpFile.name);
    }

    assert.strictEqual(
      actualContent.toString("hex"),
      expectedContent.toString("hex"),
      "連続保存後に全角チルダが波ダッシュに変換されなかった",
    );
  });
});

/**
 * 保存後変換のデバウンス待機中(ドキュメントがdirtyで先送りされている間)に
 * 処理が中断された場合のテスト
 * https://github.com/yutotnh/wave-dash-unify/issues/13
 *
 * 保存後の変換はデバウンスされ、かつドキュメントがdirtyの間は先送りされる
 * (runScheduledConversionのisDirtyチェック)。この「先送りされたまま」の状態から、
 * - タブが閉じられた場合(tabGroups.onDidChangeTabs -> flushPendingConversionsWithoutOpenTab)
 * - dirtyのまま次の保存が行われた場合(runScheduledConversionの再スケジュール)
 * のそれぞれで変換が実行されることを確認する。
 *
 * 素朴に「保存 -> すぐに経路を発火 -> 変換を確認」と書くと、
 * SAVE_CONVERSION_DEBOUNCE_MSのタイマーが経路の発火より先に発火して
 * 変換されただけでもテストが通ってしまい、対象の経路を検証したことにならない。
 * そのため、保存直後にドキュメントをdirtyにしてタイマーを先送りさせ、
 * 「まだ変換されていないこと」を確認してから対象の経路を発火させている。
 *
 * 以下の2つの経路は、この統合テストでは検証できないため対象外にしている
 * (次に同じ調査をする人のために、理由を残す):
 *
 * - **deactivate経路**: `extension.ts`のmain(`package.json`)は`dist/extension.js`
 *   (webpackバンドル)を指しており、これがVS Codeに実際にactivateされるインスタンス。
 *   一方、このテストファイルが`import`する`extension`モジュールは`out/extension.js`
 *   (tscの出力)で、ソースは同じでもNode上は別のモジュールインスタンスになる。
 *   `pendingConversions`はモジュール内のプライベートな可変状態のため、テストから
 *   `extension.deactivate()`を呼んでも、実際に動いている拡張機能の`pendingConversions`
 *   (実イベントで積まれたもの)には一切触れられない
 *   (`require("../../../dist/extension")`で同一の絶対パスを直接requireしてみても、
 *   VS Codeの拡張ホストは独自のモジュールローダーを使っておりNodeの標準的な
 *   requireキャッシュ経由での共有は成立しないことを確認済み)。
 *   これを検証するには`extension.ts`側にテスト専用のフックを設ける必要があり、
 *   本番コードに与える影響に対して割に合わないと判断し見送った
 * - **onDidCloseTextDocumentのみに依存したテスト**: `@types/vscode`の定義コメントに
 *   「タブを閉じた時にこのイベントが発火する保証はない」と明記されており、実際に
 *   タブを閉じるだけの操作では(30秒待っても)発火しないことを確認した。
 *   そのため実装側もtabGroups.onDidChangeTabsを主な発火源に変更しており、
 *   このテストも(結果的に)tabGroups経由の経路を検証している
 */
suite("保存後変換のデバウンス: 待機中に中断された場合", () => {
  // 文字列: "ああああ～"
  const initialContent = Buffer.from([
    0xa4, 0xa2, 0xa4, 0xa2, 0xa4, 0xa2, 0xa4, 0xa2, 0x8f, 0xa2, 0xb7,
  ]);

  /**
   * デバウンス待機中に処理が中断される経路を検証するための共通セットアップ
   *
   * EUC-JP+全角チルダのファイルを開き、まず"a"を挿入してdirtyにしてから保存する。
   * TextDocument.save()は「ドキュメントがdirtyでない場合は何もせず(実際の保存も
   * onDidSaveTextDocumentイベントの発火もされずに)trueで解決する」仕様のため、
   * 開いた直後のdirtyでないドキュメントに対して呼んでも変換はスケジュールされない
   * (これに気づかず、フラッシュ対象が一度もスケジュールされないまま「まだ変換
   * されていない」assertだけが偶然パスしてしまうテストになっていたことがあった)。
   * "a"を挿入してからのsave()は実際にディスクへ書き込まれ、onDidSaveTextDocument
   * 経由で変換が確実にスケジュールされる。
   *
   * その直後にすぐ"b"を挿入してdirtyにすることで、タイマー発火時に
   * runScheduledConversionが変換を先送りする(pendingConversionsにtimer:
   * undefinedのまま残る)。先送りが効いている(="a"までの内容のまま変換されて
   * いないこと)を確認してから返す。
   *
   * @returns tmpFile: 一時ファイル, document: 開いたドキュメント, textEditor: 表示したエディタ
   */
  async function setupPendingConversion(): Promise<{
    tmpFile: tmp.FileResult;
    document: vscode.TextDocument;
    textEditor: vscode.TextEditor;
  }> {
    const waveDashUnifyConfig =
      vscode.workspace.getConfiguration("waveDashUnify");
    await waveDashUnifyConfig.update(
      "enableConvert",
      true,
      vscode.ConfigurationTarget.Global,
    );
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

    const tmpFile = tmp.fileSync();
    fs.writeFileSync(tmpFile.name, initialContent);

    const document = await vscode.workspace.openTextDocument(tmpFile.name);
    const textEditor = await vscode.window.showTextDocument(document);

    // テストの前提: ファイルがEUC-JPと判定されていること
    assert.strictEqual(
      document.encoding,
      "eucjp",
      "前提条件エラー: ファイルがEUC-JPと判定されなかった",
    );

    // "a"を挿入してdirtyにしてから保存する。これにより実際にディスクへ書き込まれ、
    // onDidSaveTextDocument経由で変換が確実にスケジュールされる
    // (SAVE_CONVERSION_DEBOUNCE_MS後に実行される予定)
    await textEditor.edit((editBuilder) => {
      const lastLine = document.lineCount - 1;
      const lastLineLength = document.lineAt(lastLine).text.length;
      editBuilder.insert(new vscode.Position(lastLine, lastLineLength), "a");
    });
    await document.save();

    // すぐに"b"を挿入してdirtyにする。これによりタイマー発火時にrunScheduledConversionが
    // isDirtyを見て変換を先送りする(pendingConversionsにtimer: undefinedのまま残る)
    await textEditor.edit((editBuilder) => {
      const lastLine = document.lineCount - 1;
      const lastLineLength = document.lineAt(lastLine).text.length;
      editBuilder.insert(new vscode.Position(lastLine, lastLineLength), "b");
    });

    // デバウンスタイマーが発火し、先送り判定が行われるまで待つ
    await new Promise((resolve) =>
      setTimeout(resolve, extension.SAVE_CONVERSION_DEBOUNCE_MS * 2 + 100),
    );

    // 先送りが効いていること(="a"までの内容のまま、まだ変換されていないこと)を
    // 確認する。これを確認せずに以降のassertだけを見ると、対象の経路ではなく
    // デバウンスタイマーの発火だけでテストが通ってしまう可能性がある
    const expectedBeforeTrigger = Buffer.concat([
      initialContent,
      Buffer.from("a"),
    ]);
    const contentBeforeTrigger = fs.readFileSync(tmpFile.name);
    assert.strictEqual(
      contentBeforeTrigger.toString("hex"),
      expectedBeforeTrigger.toString("hex"),
      "前提条件エラー: dirty状態でも変換が実行されてしまった(先送りが効いていない)",
    );

    return { tmpFile, document, textEditor };
  }

  test("待機中にタブを閉じたら、その場で変換される", async function () {
    this.timeout(30000);

    const { tmpFile } = await setupPendingConversion();

    // 変更を破棄してタブを閉じる。dirtyのまま普通に閉じると保存確認ダイアログで
    // テストが固まるため、revertAndCloseActiveEditorで破棄しながら閉じる。
    // ディスク上には保存済みの内容(全角チルダと"a"を含む、"b"の追記は未保存のため
    // 含まれない)が残っており、それがtabGroups.onDidChangeTabs経由で変換されるのが
    // 期待動作
    await vscode.commands.executeCommand(
      "workbench.action.revertAndCloseActiveEditor",
    );

    // 文字列: "ああああ～a" -> "ああああ〜a"(波ダッシュに変換される。"b"は未保存のため含まれない)
    const expectedContent = Buffer.concat([
      Buffer.from([0xa4, 0xa2, 0xa4, 0xa2, 0xa4, 0xa2, 0xa4, 0xa2, 0xa1, 0xc1]),
      Buffer.from("a"),
    ]);

    // tabGroups.onDidChangeTabsの発火には多少の遅延があり得るため、ポーリングで待つ
    const deadline = Date.now() + 5000;
    let actualContent = fs.readFileSync(tmpFile.name);
    while (
      Date.now() < deadline &&
      Buffer.compare(actualContent, expectedContent) !== 0
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      actualContent = fs.readFileSync(tmpFile.name);
    }

    assert.strictEqual(
      actualContent.toString("hex"),
      expectedContent.toString("hex"),
      "待機中にタブを閉じても変換されなかった",
    );
  });

  test("待機中にdirtyのまま再保存したら、そこで変換される", async function () {
    this.timeout(30000);

    const { tmpFile, document } = await setupPendingConversion();

    // dirtyのまま先送りされていた変換が、次の保存で実行されることを確認する
    await document.save();

    // 文字列: "ああああ～a" + "b" -> "ああああ〜ab"(波ダッシュに変換される)
    const expectedContent = Buffer.concat([
      Buffer.from([0xa4, 0xa2, 0xa4, 0xa2, 0xa4, 0xa2, 0xa4, 0xa2, 0xa1, 0xc1]),
      Buffer.from("ab"),
    ]);

    // 再保存によりスケジュールされた変換が完了するまでポーリングで待つ
    const deadline = Date.now() + 5000;
    let actualContent = fs.readFileSync(tmpFile.name);
    while (
      Date.now() < deadline &&
      Buffer.compare(actualContent, expectedContent) !== 0
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      actualContent = fs.readFileSync(tmpFile.name);
    }

    assert.strictEqual(
      actualContent.toString("hex"),
      expectedContent.toString("hex"),
      "dirtyのまま再保存しても先送りされていた変換が実行されなかった",
    );

    await vscode.commands.executeCommand(
      "workbench.action.revertAndCloseActiveEditor",
    );
  });
});
