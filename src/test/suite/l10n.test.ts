import * as l10n from "@vscode/l10n";
import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as tmp from "tmp";
import { bundleFileNames, loadBundleFile, setupL10n } from "../../l10n";

// out/test/suite から見た拡張機能のルート
const extensionPath = path.resolve(__dirname, "../../../");

const ENABLED_TOOLTIP = "Wave Dash Unify is enabled (click to disable)";

suite("l10n", () => {
  test("言語IDに対応するバンドル名を返す", () => {
    assert.deepStrictEqual(bundleFileNames("ja"), ["bundle.l10n.ja.json"]);
  });

  test("地域付きの言語IDでは基底言語も候補にする", () => {
    assert.deepStrictEqual(bundleFileNames("zh-cn"), [
      "bundle.l10n.zh-cn.json",
      "bundle.l10n.zh.json",
    ]);
  });

  test("大文字を含む言語IDも小文字のファイル名にする", () => {
    assert.deepStrictEqual(bundleFileNames("pt-BR"), [
      "bundle.l10n.pt-br.json",
      "bundle.l10n.pt.json",
    ]);
  });

  suite("loadBundleFile", () => {
    // @vscode/l10nの状態はモジュール全体で共有されるため、他のテストに残さない
    teardown(() => {
      l10n.config({ contents: {} });
    });

    test("日本語では同梱の訳を返す", () => {
      loadBundleFile(extensionPath, "ja");

      assert.strictEqual(
        l10n.t(ENABLED_TOOLTIP),
        "Wave Dash Unify は有効です (クリックで無効化)",
      );
    });

    test("バンドルの無い言語では英語の原文を返す", () => {
      loadBundleFile(extensionPath, "ja");
      loadBundleFile(extensionPath, "en");

      assert.strictEqual(l10n.t(ENABLED_TOOLTIP), ENABLED_TOOLTIP);
    });

    test("バンドルが壊れていても例外を投げず英語の原文を返す", () => {
      const dir = tmp.dirSync({ unsafeCleanup: true });
      try {
        fs.mkdirSync(path.join(dir.name, "l10n"));
        fs.writeFileSync(
          path.join(dir.name, "l10n", "bundle.l10n.ja.json"),
          "{ broken",
        );

        loadBundleFile(dir.name, "ja");

        assert.strictEqual(l10n.t(ENABLED_TOOLTIP), ENABLED_TOOLTIP);
      } finally {
        dir.removeCallback();
      }
    });
  });

  test("setupL10nはどのバージョンのVS Codeでも例外を投げない", () => {
    // 1.73.0未満はloadBundleFile、以降はvscode.l10n.bundleの経路を通る
    try {
      assert.doesNotThrow(() => {
        setupL10n(extensionPath);
      });
    } finally {
      l10n.config({ contents: {} });
    }
  });
});
