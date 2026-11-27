import * as assert from "assert";
import * as fs from "fs";
import * as tmp from "tmp";
import * as vscode from "vscode";
import { CHARS, detectEncoding, isEucJpBuffer } from "../../eucjp";
import { createSaveConverter } from "../../saveConverter";

/**
 * VS Code 1.100.0未満の経路(バイト列での判定)を固定するテスト
 *
 * detectEncodingは`document.encoding`の有無だけを見るので、`.encoding`を持たない
 * ダミーのドキュメントを渡せば、テストを実行するVS Codeのバージョンに関係なく
 * この経路を踏める
 *
 * isEucJpBuffer自体の境界値はextension.test.tsの"isEucJpBuffer"で固定してある
 */
suite("EUC-JP legacy path (VS Code 1.100.0未満のバイト列判定)", () => {
  test("encodingが無いドキュメントはunknownと判定される", () => {
    assert.strictEqual(
      detectEncoding({} as vscode.TextDocument),
      "unknown",
      "document.encodingが無いのに確定判定が返った",
    );
  });

  test("UTF-8の日本語はEUC-JPと判定されない", () => {
    // UTF-8の"よろしく"
    const utf8Content = Buffer.from([
      0xe3, 0x82, 0x88, 0xe3, 0x82, 0x8d, 0xe3, 0x81, 0x97, 0xe3, 0x81, 0x8f,
    ]);

    assert.strictEqual(isEucJpBuffer(utf8Content), false);
  });

  test("EUC-JPの日本語はEUC-JPと判定される", () => {
    // EUC-JPの"ああああ"
    const eucjpContent = Buffer.from([
      0xa4, 0xa2, 0xa4, 0xa2, 0xa4, 0xa2, 0xa4, 0xa2,
    ]);

    assert.strictEqual(isEucJpBuffer(eucjpContent), true);
  });

  /**
   * 1.100.0未満の経路で、ディスクへの書き込みがバイト列の判定に守られていることを固定する
   *
   * 判定関数を単体で呼ぶだけでは、convertFileから判定が消えても緑のままになるので、
   * 保存後の変換を実際に通してディスクの中身を確かめる
   */
  suite("ディスクへの書き込みがバイト列の判定に守られていること", () => {
    const configKeys = [
      "enableConvert",
      "fullwidthTildeToWaveDash",
      "numeroSignToNumeroSign",
    ];

    async function updateAllConfigs(value: boolean | undefined) {
      const config = vscode.workspace.getConfiguration("waveDashUnify");
      for (const key of configKeys) {
        await config.update(key, value, vscode.ConfigurationTarget.Global);
      }
    }

    suiteSetup(async () => {
      await updateAllConfigs(true);
    });

    suiteTeardown(async () => {
      await updateAllConfigs(undefined);
    });

    /**
     * fileNameのファイルを、`.encoding`を持たない閉じたドキュメントとして変換する
     *
     * 閉じたドキュメントはエディタとの同期が不要なので、convertOnCloseで
     * 待ち合わせなしに変換される
     */
    function convertAsLegacyDocument(fileName: string) {
      const document = {
        uri: vscode.Uri.file(fileName),
        fileName,
        isClosed: true,
        isDirty: false,
        getText: () => CHARS.fullwidthTilde,
      } as unknown as vscode.TextDocument;

      const converter = createSaveConverter();
      converter.schedule(document);
      converter.convertOnClose(document);
      converter.dispose();
    }

    test("変換対象のバイト列を含んでいてもEUC-JPでなければ書き換えない", () => {
      // 全角チルダのバイト列(0x8F 0xA2 0xB7)を含むが、
      // 直後の0x80がEUC-JPのどの並びにも当てはまらないため全体としては不正
      const contents = Buffer.from([0x8f, 0xa2, 0xb7, 0x80]);
      const file = tmp.fileSync();
      fs.writeFileSync(file.name, contents);

      convertAsLegacyDocument(file.name);

      assert.deepStrictEqual(
        Array.from(fs.readFileSync(file.name)),
        Array.from(contents),
        "変換対象のバイト列を含む非EUC-JPのファイルが書き換えられた",
      );
    });

    test("EUC-JPであれば書き換える(判定が常にfalseになっていないこと)", () => {
      // "A" + 全角チルダ + "B"
      const file = tmp.fileSync();
      fs.writeFileSync(file.name, Buffer.from([0x41, 0x8f, 0xa2, 0xb7, 0x42]));

      convertAsLegacyDocument(file.name);

      assert.deepStrictEqual(
        Array.from(fs.readFileSync(file.name)),
        // 全角チルダ(0x8F 0xA2 0xB7)が波ダッシュ(0xA1 0xC1)に置き換わる
        [0x41, 0xa1, 0xc1, 0x42],
        "EUC-JPのファイルが変換されなかった",
      );
    });
  });
});
