import * as assert from "assert";
import * as extension from "../../extension";

import * as vscode from "vscode";

/**
 * CONVERT_TARGETSのテーブルが変換対象の単一の定義源になっていることを検証する
 *
 * containsConvertTargetCharacters(Unicode文字での判定)と
 * replaceSpecificCharactersInBuffer(バイト列での変換)は同じテーブルから
 * 駆動されるべきものだが、片方にだけ変換対象が追加されても
 * 「新しい変換が静かに一切効かない」という形でしか現れず気付きにくい(issue #634)。
 *
 * このテストはCONVERT_TARGETSを走査して両方の関数を確認するため、
 * テーブルにエントリを追加すれば自動的にそのエントリも検証対象になる
 */
suite("Convert Targets Table Test Suite", () => {
  // 同じ設定キーを複数のエントリが共有していても1回だけ更新すればよい
  const configKeys = [
    ...new Set(extension.CONVERT_TARGETS.map((target) => target.configKey)),
  ];

  /**
   * 変換対象の有効/無効設定をまとめて更新する
   *
   * @param value 設定値(undefinedでデフォルトに戻す)
   */
  async function updateAllConfigs(value: boolean | undefined) {
    const config = vscode.workspace.getConfiguration("waveDashUnify");

    await Promise.all(
      configKeys.map((configKey) =>
        config.update(configKey, value, vscode.ConfigurationTarget.Global),
      ),
    );
  }

  /**
   * 変換対象文字を含むドキュメントを作る
   *
   * containsConvertTargetCharactersはdocument.getText()だけを見る
   * (EUC-JPかどうかの判定は呼び出し側の責務)ため、
   * 一時ファイルやエンコーディングの自動判定は不要
   *
   * @param char ドキュメントに含める文字
   * @returns 生成したドキュメント
   */
  async function openDocumentContaining(
    char: string,
  ): Promise<vscode.TextDocument> {
    return vscode.workspace.openTextDocument({
      language: "plaintext",
      content: `あ${char}あ`,
    });
  }

  // 他のテストスイートと同じVS Codeインスタンス・同じグローバル設定を共有するため、
  // このスイートで変更した設定は必ずデフォルトに戻す
  teardown(async () => {
    await updateAllConfigs(undefined);
  });

  /**
   * replaceSpecificCharactersInBufferの実装が前提にしているテーブルの不変条件を固定する
   */
  test("every entry satisfies the assumptions of the byte scan", () => {
    const SS3 = 0x8f;

    for (const target of extension.CONVERT_TARGETS) {
      assert.strictEqual(
        target.from[0],
        SS3,
        `変換前のバイト列がSS3で始まっていない: ${target.configKey}`,
      );
      assert.ok(
        // CONVERT_TARGETSはas constで定義されているため現在のエントリでは
        // 常にtrueと静的に分かるが、将来エントリが増えたときの回帰防止として残す
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        target.to.length <= target.from.length,
        `変換後のバイト列が変換前より長い: ${target.configKey}`,
      );
    }
  });

  /**
   * テーブルの各エントリが両方の関数に反映されていることを確認する
   *
   * 片方の関数にしか反映されていないエントリがあればここで落ちる
   */
  test("every enabled entry is detected and converted", async () => {
    await updateAllConfigs(true);

    for (const target of extension.CONVERT_TARGETS) {
      const document = await openDocumentContaining(target.char);
      assert.strictEqual(
        extension.containsConvertTargetCharacters(document),
        true,
        `containsConvertTargetCharactersが変換対象文字を検出しなかった: ${target.configKey}`,
      );

      const actual = extension.replaceSpecificCharactersInBuffer(
        Buffer.from([0xa4, 0xa2, ...target.from, 0xa4, 0xa2]),
      );
      assert.strictEqual(
        actual.toString("hex"),
        Buffer.from([0xa4, 0xa2, ...target.to, 0xa4, 0xa2]).toString("hex"),
        `replaceSpecificCharactersInBufferが変換しなかった: ${target.configKey}`,
      );
    }
  });

  /**
   * エントリごとに、その設定キーだけを有効にしても両方の関数に反映されることを確認する
   *
   * 設定キーの読み込みがテーブルから駆動されていない(特定のキーを直接読んでいる)場合、
   * 新しいエントリの設定が無視されるためここで落ちる
   */
  test("every entry is driven by its own config key", async () => {
    for (const target of extension.CONVERT_TARGETS) {
      await updateAllConfigs(false);

      const config = vscode.workspace.getConfiguration("waveDashUnify");
      await config.update(
        target.configKey,
        true,
        vscode.ConfigurationTarget.Global,
      );

      const document = await openDocumentContaining(target.char);
      assert.strictEqual(
        extension.containsConvertTargetCharacters(document),
        true,
        `設定を有効にしてもcontainsConvertTargetCharactersが検出しなかった: ${target.configKey}`,
      );

      const actual = extension.replaceSpecificCharactersInBuffer(
        Buffer.from([...target.from]),
      );
      assert.strictEqual(
        actual.toString("hex"),
        Buffer.from([...target.to]).toString("hex"),
        `設定を有効にしてもreplaceSpecificCharactersInBufferが変換しなかった: ${target.configKey}`,
      );
    }
  });

  /**
   * すべての設定を無効にすると、どのエントリも変換対象と見なされないことを確認する
   *
   * 変換対象が1つも無い場合に入力のBufferがそのまま(コピーせず)返る挙動も
   * ここで固定する(convertSavedFileが参照比較で書き換え不要と判定するため)
   */
  test("no entry is a convert target while all configs are disabled", async () => {
    await updateAllConfigs(false);

    for (const target of extension.CONVERT_TARGETS) {
      const document = await openDocumentContaining(target.char);
      assert.strictEqual(
        extension.containsConvertTargetCharacters(document),
        false,
        `設定が無効なのにcontainsConvertTargetCharactersが検出した: ${target.configKey}`,
      );

      const contents = Buffer.from([...target.from]);
      assert.strictEqual(
        extension.replaceSpecificCharactersInBuffer(contents),
        contents,
        `設定が無効なのに入力のBufferがそのまま返らなかった: ${target.configKey}`,
      );
    }
  });
});
