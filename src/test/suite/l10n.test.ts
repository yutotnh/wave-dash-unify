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

  // 日本語で起動したVS Codeでの確認(l10n.locale.test.ts)では区別できない分岐だけを、
  // vscode相当を差し替えて確かめる
  suite("setupL10n", () => {
    teardown(() => {
      l10n.config({ contents: {} });
    });

    test("1.73.0以降はvscode.l10n.bundleを使い、l10n/は読まない", () => {
      // 表示言語はjaだが、l10n/の訳ではなくbundleの訳が使われることを確かめる
      setupL10n(extensionPath, {
        env: { language: "ja" },
        l10n: { bundle: { [ENABLED_TOOLTIP]: "bundle の訳" } },
      });

      assert.strictEqual(l10n.t(ENABLED_TOOLTIP), "bundle の訳");
    });

    test("1.73.0以降で訳の無い言語(bundleがundefined)では英語の原文を返す", () => {
      loadBundleFile(extensionPath, "ja");
      setupL10n(extensionPath, {
        env: { language: "en" },
        l10n: { bundle: undefined },
      });

      assert.strictEqual(l10n.t(ENABLED_TOOLTIP), ENABLED_TOOLTIP);
    });
  });
});
