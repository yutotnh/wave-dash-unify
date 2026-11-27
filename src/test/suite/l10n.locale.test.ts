import * as l10n from "@vscode/l10n";
import * as assert from "assert";
import * as path from "path";
import * as vscode from "vscode";
import { setupL10n } from "../../l10n";

/**
 * 日本語で起動したVS Codeで実行するテスト(runTest.tsの2回目の起動)
 *
 * 1.73.0未満ではl10n/を自分で読む経路、以降ではVS Codeが読み込んだ
 * vscode.l10n.bundleを渡す経路を通る。CIは両方のバージョンで実行する
 */
suite("l10n (ja)", () => {
  teardown(() => {
    l10n.config({ contents: {} });
  });

  test("VS Codeが日本語で起動している", () => {
    assert.strictEqual(vscode.env.language, "ja");
  });

  test("setupL10nで日本語の訳が返る", () => {
    // out/test/suite から見た拡張機能のルート
    setupL10n(path.resolve(__dirname, "../../../"));

    assert.strictEqual(
      l10n.t("Wave Dash Unify is enabled (click to disable)"),
      "Wave Dash Unify は有効です (クリックで無効化)",
    );
  });
});
