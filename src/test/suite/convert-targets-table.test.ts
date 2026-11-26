import * as assert from "assert";
import * as vscode from "vscode";
import { readConfig } from "../../config";
import { convertBytes, TARGETS } from "../../eucjp";

/**
 * TARGETSが変換対象の唯一の定義になっていることを確かめる
 *
 * 設定の読み込みとバイト列の変換が同じ表から動いていないと、表に追加した
 * 変換が静かに効かない形でしか現れず気付きにくい(issue #634)。
 * 表を走査して確かめるので、エントリを追加すれば自動で検証対象になる
 */
suite("Convert Targets Table Test Suite", () => {
  const configKeys = [...new Set(TARGETS.map((target) => target.configKey))];

  /** 変換対象の設定をまとめて更新する(undefinedでデフォルトに戻す) */
  async function updateAllConfigs(value: boolean | undefined) {
    const config = vscode.workspace.getConfiguration("waveDashUnify");

    await Promise.all(
      configKeys.map((configKey) =>
        config.update(configKey, value, vscode.ConfigurationTarget.Global),
      ),
    );
  }

  // 他のスイートと設定を共有するので、必ずデフォルトに戻す
  teardown(async () => {
    await updateAllConfigs(undefined);
  });

  /** convertBytesが前提にしている表の制約を固定する */
  test("every entry satisfies the assumptions of the byte scan", () => {
    const SS3 = 0x8f;

    for (const target of TARGETS) {
      assert.strictEqual(
        target.from[0],
        SS3,
        `変換前のバイト列がSS3で始まっていない: ${target.configKey}`,
      );
      assert.ok(
        // 今のエントリでは静的にtrueだが、エントリが増えたときの回帰防止として残す
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        target.to.length <= target.from.length,
        `変換後のバイト列が変換前より長い: ${target.configKey}`,
      );
    }
  });

  /**
   * エントリごとに、その設定キーだけを有効にすると変換されることを確かめる
   *
   * 設定の読み込みが表から動いていない(特定のキーを直接読んでいる)とここで落ちる
   */
  test("every entry is driven by its own config key", async () => {
    for (const target of TARGETS) {
      await updateAllConfigs(false);
      await vscode.workspace
        .getConfiguration("waveDashUnify")
        .update(target.configKey, true, vscode.ConfigurationTarget.Global);

      const { targets } = readConfig();
      assert.deepStrictEqual(
        targets.map((t) => t.configKey),
        [target.configKey],
        `設定を有効にしても変換対象にならなかった: ${target.configKey}`,
      );

      const actual = convertBytes(
        Buffer.from([0xa4, 0xa2, ...target.from, 0xa4, 0xa2]),
        targets,
      );
      assert.strictEqual(
        actual.toString("hex"),
        Buffer.from([0xa4, 0xa2, ...target.to, 0xa4, 0xa2]).toString("hex"),
        `変換されなかった: ${target.configKey}`,
      );
    }
  });

  /**
   * すべて無効なら変換対象が無く、入力のBufferがそのまま返ることを確かめる
   *
   * convertFileは参照の比較で書き換え不要と判定するため、この挙動を固定する
   */
  test("no entry is a convert target while all configs are disabled", async () => {
    await updateAllConfigs(false);

    const { targets } = readConfig();
    assert.deepStrictEqual(targets, []);

    for (const target of TARGETS) {
      const contents = Buffer.from([...target.from]);
      assert.strictEqual(
        convertBytes(contents, targets),
        contents,
        `入力のBufferがそのまま返らなかった: ${target.configKey}`,
      );
    }
  });
});
