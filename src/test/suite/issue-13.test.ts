import * as assert from "assert";
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
