import * as assert from "assert";
import * as vscode from "vscode";
import * as extension from "../../extension";

/**
 * EUC-JPのコーデックに関する前提を固定化するテスト
 *
 * この拡張機能は「EUC-JPファイルをデコードした結果に波ダッシュ(U+301C)は
 * 現れない」という前提の上に成り立っている(issue #635)。
 * この前提はVS Code側のデコーダの挙動に依存するため、将来VS Codeの
 * コーデック実装が変わった場合に気付けるよう、ここでテストとして固定する。
 *
 * 各テストは`vscode.workspace.decode`/`encode`に`encoding: "eucjp"`を
 * 明示して使う。未対応のエンコーディング名を渡すと既定のエンコーディング
 * (UTF-8)にフォールバックしてしまうため、UTF-8では成立しない
 * バイト列との厳密比較で「本当にEUC-JPとして処理されたか」も併せて検証する
 */
suite("EUC-JP encoding invariants", () => {
  // EUC-JPにおける波ダッシュのバイト列
  const WAVE_DASH_BYTES = Uint8Array.from([0xa1, 0xc1]);
  // EUC-JPにおける全角チルダのバイト列(3バイトのSS3領域)
  const FULLWIDTH_TILDE_BYTES = Uint8Array.from([0x8f, 0xa2, 0xb7]);

  const WAVE_DASH = String.fromCodePoint(extension.WAVEDASH_CODE_POINT);
  const FULLWIDTH_TILDE = String.fromCodePoint(
    extension.FULLWIDTH_TILDE_CODE_POINT,
  );

  const decodeEucjp = (bytes: Uint8Array): Thenable<string> =>
    vscode.workspace.decode(bytes, { encoding: "eucjp" });
  const encodeEucjp = (text: string): Thenable<Uint8Array> =>
    vscode.workspace.encode(text, { encoding: "eucjp" });

  test("波ダッシュのバイト列(0xA1 0xC1)は全角チルダ(U+FF5E)にデコードされる", async () => {
    const decoded = await decodeEucjp(WAVE_DASH_BYTES);

    assert.strictEqual(
      decoded,
      FULLWIDTH_TILDE,
      "0xA1 0xC1がU+FF5Eにデコードされなかった",
    );
    assert.notStrictEqual(
      decoded,
      WAVE_DASH,
      "0xA1 0xC1がU+301Cにデコードされた(EUC-JPのデコード結果に波ダッシュは現れないという前提が崩れている)",
    );
  });

  test("全角チルダのバイト列(0x8F 0xA2 0xB7)も全角チルダ(U+FF5E)にデコードされる", async () => {
    const decoded = await decodeEucjp(FULLWIDTH_TILDE_BYTES);

    assert.strictEqual(
      decoded,
      FULLWIDTH_TILDE,
      "0x8F 0xA2 0xB7がU+FF5Eにデコードされなかった",
    );
  });

  test("全角チルダ(U+FF5E)は3バイトの全角チルダ(0x8F 0xA2 0xB7)にエンコードされる", async () => {
    // VS CodeのEUC-JPコーデックは非対称で、0xA1 0xC1と0x8F 0xA2 0xB7の
    // どちらもU+FF5Eにデコードされる一方、U+FF5Eをエンコードすると
    // 常に3バイトの0x8F 0xA2 0xB7になる。
    // つまりデコードとエンコードを往復しても0xA1 0xC1は得られないため、
    // 文字列の再エンコードでは全角チルダ→波ダッシュの変換を実現できない。
    //
    // "eucjp"が実際に使われていることを確かめる対照実験でもある。
    // UTF-8にフォールバックしていれば0xEF 0xBD 0x9Eになり、このテストが落ちる
    const encoded = await encodeEucjp(FULLWIDTH_TILDE);

    assert.deepStrictEqual(
      Array.from(encoded),
      Array.from(FULLWIDTH_TILDE_BYTES),
      "U+FF5EがEUC-JPの0x8F 0xA2 0xB7にエンコードされなかった",
    );
  });

  test("波ダッシュ(U+301C)はEUC-JPで表現できず'?'(0x3F)にエンコードされる", async () => {
    const encoded = await encodeEucjp(WAVE_DASH);

    assert.deepStrictEqual(
      Array.from(encoded),
      [0x3f],
      "U+301Cが'?'(0x3F)にエンコードされなかった",
    );
    assert.notDeepStrictEqual(
      Array.from(encoded),
      Array.from(WAVE_DASH_BYTES),
      "U+301Cが0xA1 0xC1にエンコードされた(U+301CはEUC-JPで表現できないという前提が崩れている)",
    );
  });

  test("EUC-JPファイル由来のテキストではcountSpecificCharactersの波ダッシュ分は常に0件になる", async () => {
    // 波ダッシュのバイト列と全角チルダのバイト列を混在させた
    // EUC-JPファイル相当のバイト列を用意する
    const bytes = Uint8Array.from([
      ...WAVE_DASH_BYTES,
      ...FULLWIDTH_TILDE_BYTES,
      ...WAVE_DASH_BYTES,
    ]);

    const decoded = await decodeEucjp(bytes);

    assert.strictEqual(
      decoded.includes(WAVE_DASH),
      false,
      `デコード結果にU+301Cが含まれている: ${JSON.stringify(decoded)}`,
    );

    const count = extension.countSpecificCharacters(decoded);

    // 3文字すべてがU+FF5Eとしてカウントされる。
    // つまりcountSpecificCharactersのWAVE_DASH_CHAR分の寄与は0件であり、
    // EUC-JPのファイルに対しては実質デッドコードになっている
    assert.strictEqual(
      count.waveDashAndFullwidthTilde,
      3,
      "全角チルダとしてのカウントが期待値と一致しなかった",
    );
    assert.strictEqual(
      (decoded.match(new RegExp(FULLWIDTH_TILDE, "g")) ?? []).length,
      count.waveDashAndFullwidthTilde,
      "カウント結果が全角チルダの出現回数と一致しなかった(波ダッシュ分が加算されている)",
    );
  });
});
