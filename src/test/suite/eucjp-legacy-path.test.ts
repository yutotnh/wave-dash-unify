import * as assert from "assert";
import * as fs from "fs";
import * as tmp from "tmp";
import * as vscode from "vscode";
import * as extension from "../../extension";
import {
  canBeEUCJP,
  isEUCJPBuffer,
  isEUCJPConfirmed,
  isEUCJPDocument,
  needsBytesToDecideEUCJP,
} from "../../eucjp";

/**
 * VS Code 1.100.0未満での経路(バイト列判定へのフォールバック)を固定するテスト
 *
 * isEUCJPConfirmedは、`document.encoding`が読めない場合(=isEUCJPDocumentが
 * "unknown"を返す場合)、ディスクから読んだバイト列をisEUCJPBufferに渡して
 * 確定判定する(src/eucjp.ts参照)。この経路は実際には1.100.0未満の実行時にしか
 * 通らないが、このテスト自体はテストを実行するVS Codeのバージョンに関係なく
 * 検証できるようにしたい。そのため`.encoding`を持たない最小限のダミーオブジェクトを
 * TextDocumentとして渡し、isEUCJPDocumentの判定を意図的に"unknown"にすることで、
 * テスト実行環境が1.100.0以降であってもこのフォールバック経路を確実に踏む
 *
 * isEUCJPBuffer自体の網羅的な境界値テストはextension.test.tsの
 * "isEUCJPBuffer"で固定済みのため、ここでは重複を避け、isEUCJPConfirmedが
 * isEUCJPBufferの結果をそのまま確定判定として使っていることだけを確認する
 */
suite("EUC-JP legacy path (VS Code 1.100.0未満のバイト列判定)", () => {
  /**
   * `.encoding`を持たないダミーのTextDocumentを作る
   *
   * isEUCJPDocumentはdocument.encodingの有無だけを見て"unknown"かどうかを
   * 判定するため、この最小限のオブジェクトだけで1.100.0未満相当の状態を
   * 再現できる
   *
   * @returns encodingプロパティを持たないダミーのTextDocument
   */
  function documentWithoutEncoding(): vscode.TextDocument {
    return {} as vscode.TextDocument;
  }

  /**
   * 過剰近似の契約を固定する
   *
   * canBeEUCJPとneedsBytesToDecideEUCJPは「ディスクを読む前の足切り」であって、
   * ファイルを書き換えてよいかの判断には使えない。1.100.0未満では
   * canBeEUCJPが常にtrueを返す(=何も落とせない)という性質は、
   * extension.ts側の設計(convertSavedFileで必ずisEUCJPConfirmedを通す、
   * scheduleSaveConversionでcontainsConvertTargetCharactersによる足切りを足す)が
   * 前提にしているもの。誤ってcanBeEUCJPを確定判定として扱う変更が入ったときに
   * 気付けるよう、ここで契約として固定しておく
   */
  test("1.100.0未満相当のドキュメントでは判定が過剰近似になる", () => {
    const document = documentWithoutEncoding();

    assert.strictEqual(
      isEUCJPDocument(document),
      "unknown",
      "document.encodingが無いのに確定判定が返った",
    );
    assert.strictEqual(
      needsBytesToDecideEUCJP(document),
      true,
      "確定判定にバイト列が必要だと判定されなかった",
    );
    assert.strictEqual(
      canBeEUCJP(document),
      true,
      "判定材料が無いのにEUC-JPの可能性が否定された(過剰近似になっていない)",
    );
  });

  test("UTF-8の日本語ファイルの内容はEUC-JPと判定されない", () => {
    // UTF-8の"よろしく"
    const utf8Content = Buffer.from([
      0xe3, 0x82, 0x88, 0xe3, 0x82, 0x8d, 0xe3, 0x81, 0x97, 0xe3, 0x81, 0x8f,
    ]);

    assert.strictEqual(
      isEUCJPBuffer(utf8Content),
      false,
      "UTF-8のバイト列がisEUCJPBufferでEUC-JPと判定された",
    );
    assert.strictEqual(
      isEUCJPConfirmed(documentWithoutEncoding(), utf8Content),
      false,
      "UTF-8のバイト列がisEUCJPConfirmed(legacy path)でEUC-JPと判定された",
    );
  });

  /**
   * 1.100.0未満の経路で、ディスクへの書き込みが確定判定に守られていることを固定する
   *
   * convertSavedFileは「置換の走査 -> 置換対象があれば確定判定 -> 書き込み」の順で
   * 動く(置換対象が無ければディスクは書き換わらないので、エンコーディングを
   * 確定させる必要が無い)。この順序が安全なのは、変換対象のバイト列を含んでいても
   * EUC-JPとして妥当でなければisEUCJPConfirmedが書き込みを止めるため
   *
   * このテストは`isEUCJPConfirmed`を直接呼ばずに、公開APIの
   * `replaceSpecificCharacters`から実際の変換経路を通してディスクの中身を確認する。
   * 判定関数だけを単体で呼ぶテストでは、convertSavedFileから確定判定が
   * 丸ごと消えても緑のままになり、この不変条件を守れない
   *
   * `canBeEUCJP`は`"encoding" in document`しか見ないため、`.encoding`を持たない
   * ダミーのドキュメントを渡せば、テストを実行するVS Codeのバージョンに関係なく
   * 1.100.0未満の経路を確実に踏める
   */
  suite("ディスクへの書き込みが確定判定に守られていること", () => {
    /**
     * 変換対象文字を含むテキストを返す、`.encoding`を持たないダミーのドキュメント
     *
     * convertSavedFileまでの経路が参照するのはfileNameとgetText()だけ
     *
     * @param fileName 変換対象のファイルのパス
     * @returns ダミーのTextDocument
     */
    function documentForFile(fileName: string): vscode.TextDocument {
      return {
        fileName,
        getText: () =>
          String.fromCodePoint(extension.FULLWIDTH_TILDE_CODE_POINT),
      } as unknown as vscode.TextDocument;
    }

    suiteSetup(async () => {
      const config = vscode.workspace.getConfiguration("waveDashUnify");
      await config.update(
        "enableConvert",
        true,
        vscode.ConfigurationTarget.Global,
      );
      await config.update(
        "fullwidthTildeToWaveDash",
        true,
        vscode.ConfigurationTarget.Global,
      );
      await config.update(
        "numeroSignToNumeroSign",
        true,
        vscode.ConfigurationTarget.Global,
      );
    });

    suiteTeardown(async () => {
      const config = vscode.workspace.getConfiguration("waveDashUnify");
      await config.update(
        "enableConvert",
        undefined,
        vscode.ConfigurationTarget.Global,
      );
      await config.update(
        "fullwidthTildeToWaveDash",
        undefined,
        vscode.ConfigurationTarget.Global,
      );
      await config.update(
        "numeroSignToNumeroSign",
        undefined,
        vscode.ConfigurationTarget.Global,
      );
    });

    test("変換対象のバイト列を含んでいてもEUC-JPでなければ書き換えない", () => {
      // 全角チルダのバイト列(0x8F 0xA2 0xB7)を含むが、
      // 直後の0x80がEUC-JPのどの並びにも当てはまらないため全体としては不正
      const contents = Buffer.from([0x8f, 0xa2, 0xb7, 0x80]);
      const file = tmp.fileSync();
      fs.writeFileSync(file.name, contents);

      assert.strictEqual(
        extension.replaceSpecificCharacters(documentForFile(file.name)),
        false,
        "EUC-JPではないファイルに対して書き換えたと報告された",
      );
      assert.deepStrictEqual(
        Array.from(fs.readFileSync(file.name)),
        Array.from(contents),
        "変換対象のバイト列を含む非EUC-JPのファイルが書き換えられた",
      );
    });

    test("EUC-JPであれば書き換える(ガードが常にfalseになっていないこと)", () => {
      // "A" + 全角チルダ + "B"。EUC-JPとして妥当
      const contents = Buffer.from([0x41, 0x8f, 0xa2, 0xb7, 0x42]);
      const file = tmp.fileSync();
      fs.writeFileSync(file.name, contents);

      assert.strictEqual(
        extension.replaceSpecificCharacters(documentForFile(file.name)),
        true,
        "EUC-JPのファイルが書き換えられなかった",
      );
      assert.deepStrictEqual(
        Array.from(fs.readFileSync(file.name)),
        // 全角チルダ(0x8F 0xA2 0xB7)が波ダッシュ(0xA1 0xC1)に置き換わる
        [0x41, 0xa1, 0xc1, 0x42],
        "変換結果が期待値と一致しなかった",
      );
    });
  });

  test("EUC-JPのファイルはEUC-JPと判定される", () => {
    // EUC-JPの"ああああ"
    const eucjpContent = Buffer.from([
      0xa4, 0xa2, 0xa4, 0xa2, 0xa4, 0xa2, 0xa4, 0xa2,
    ]);

    assert.strictEqual(
      isEUCJPBuffer(eucjpContent),
      true,
      "EUC-JPのバイト列がisEUCJPBufferでEUC-JPと判定されなかった",
    );
    assert.strictEqual(
      isEUCJPConfirmed(documentWithoutEncoding(), eucjpContent),
      true,
      "EUC-JPのバイト列がisEUCJPConfirmed(legacy path)でEUC-JPと判定されなかった",
    );
  });
});
