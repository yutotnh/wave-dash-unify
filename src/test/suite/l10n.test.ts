import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import { bundleFileNames } from "../../l10n";

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

  test("日本語のバンドルが同梱される場所にある", () => {
    // out/test/suite から見た拡張機能のルート
    const extensionPath = path.resolve(__dirname, "../../../");
    const file = path.join(extensionPath, "l10n", "bundle.l10n.ja.json");

    assert.ok(fs.existsSync(file), `${file} がありません`);
  });
});
