import * as vscode from "vscode";

/**
 * EUC-JPの判定
 *
 * このモジュールは「実行中のVS CodeがどのAPIを持っているか」を知っている
 * 唯一の場所。呼び出し側(extension.ts)はVS Codeのバージョンを意識せず、
 * ここが公開する関数だけを使う
 *
 * - VS Code 1.100.0以降: `TextDocument.encoding`でVS Code自身が使っている
 *   エンコーディングをそのまま参照できる。ディスクを読まずに確定判定できて速く、
 *   「エンコーディング付きで再度開く」などユーザーの明示的な選択も正しく反映される
 * - VS Code 1.100.0未満: `TextDocument.encoding`が存在しないため、
 *   ディスク上のバイト列がEUC-JPとして妥当かを構造的に検査する
 *   (0.3系までと同じ方式)
 *
 * 分岐はVS Codeのバージョン文字列ではなくAPIの有無で行う。
 * 将来engines.vscodeを1.100.0以降に引き上げるときは、
 * `isEUCJPBuffer`と"unknown"の分岐を消せばよい
 */

/**
 * `TextDocument.encoding`を持つTextDocument
 *
 * `TextDocument.encoding`はVS Code 1.100.0で追加されたプロパティで、
 * package.jsonのengines.vscodeに合わせた@types/vscodeの型定義には含まれない。
 * 型の辻褄合わせはこのモジュールの内側だけに閉じ込める
 */
type DocumentWithEncoding = vscode.TextDocument & {
  readonly encoding?: string;
};

/** VS CodeがEUC-JPを表すのに使うエンコーディングID */
const EUCJP_ENCODING_ID = "eucjp";

/** EUC-JPのシングルシフト2(SS2)。半角カナ1文字を導入する */
const SS2 = 0x8e;

/** EUC-JPのシングルシフト3(SS3)。補助漢字(JIS X 0212)1文字を導入する */
const SS3 = 0x8f;

/**
 * EUC-JPの判定結果
 *
 * `"unknown"`は「ドキュメントの情報だけでは判定できない」という意味で、
 * VS Code 1.100.0未満でのみ返る。この場合はディスク上のバイト列を
 * `isEUCJPBuffer`に渡して判定する必要がある
 */
export type EucjpVerdict = true | false | "unknown";

/**
 * 2バイト文字を構成できるバイトかを判定する
 *
 * JIS X 0208(2バイト)とJIS X 0212(SS3 + 2バイト)のどちらの後続バイトも
 * この範囲に収まる
 *
 * @param byte 判定するバイト。呼び出し側でバッファ末尾チェックをしているため
 *   実際には`undefined`にはならないが、`buffer[i]`の型に合わせている
 * @returns `true`: 0xA1〜0xFEの範囲内, `false`: 範囲外(`undefined`を含む)
 */
function isDoubleByteRange(byte: number | undefined): boolean {
  return byte !== undefined && byte >= 0xa1 && byte <= 0xfe;
}

/**
 * SS2に続く半角カナのバイトかを判定する
 *
 * @param byte 判定するバイト。呼び出し側でバッファ末尾チェックをしているため
 *   実際には`undefined`にはならないが、`buffer[i]`の型に合わせている
 * @returns `true`: 0xA1〜0xDFの範囲内, `false`: 範囲外(`undefined`を含む)
 */
function isHalfwidthKatakanaByte(byte: number | undefined): boolean {
  return byte !== undefined && byte >= 0xa1 && byte <= 0xdf;
}

/**
 * バイト列がEUC-JPとして構造的に妥当かを判定する
 *
 * VS Code 1.100.0未満で`TextDocument.encoding`が使えない場合のフォールバック。
 * 受け付けるのは以下の並びだけで、それ以外のバイトや途中で切れた列があれば`false`を返す
 *
 * | 種別                | パターン                    |
 * | ------------------- | --------------------------- |
 * | ASCII               | 0x00〜0x7F                  |
 * | 半角カナ (SS2)      | 0x8E + 0xA1〜0xDF           |
 * | JIS X 0212 (SS3)    | 0x8F + (0xA1〜0xFE) × 2     |
 * | JIS X 0208          | (0xA1〜0xFE) × 2            |
 *
 * これは「EUC-JPとして解釈できるか」の判定であって、書かれた意図を当てるものではない。
 * そのためASCIIのみのファイルは常に`true`になるが、変換対象のバイト列は
 * いずれもSS3(0x8F)で始まるため、ASCIIのみのファイルが書き換わることはない。
 *
 * 0.3系まで使っていたencoding-japaneseの`isEUCJP`とほぼ同じ判定だが、SS3の
 * 2バイト目だけ範囲が異なる。あちらは0xA2〜0xEDに制限しており、区点でいう
 * 1区(0xA1)と78区以降を弾く。JIS X 0212の1区(ダイアクリティカルマークなど)は
 * 実在するため、ここでは構造どおり0xA1〜0xFEを受け付ける。
 * この差はSS3を含む珍しいファイルでしか効かず、変換対象である
 * 0x8F 0xA2 0xB7 / 0x8F 0xA2 0xF1(いずれも2区)の判定は両者で一致する
 *
 * 既知の限界(1.100.0未満でのみ影響する残余リスク):
 * 構造チェックである以上、EUC-JPと同じバイト構造を持つ他のマルチバイト
 * エンコーディングと区別できない。特にGBKやBig5の中文テキストは、全角記号も
 * 漢字もすべて0xA1〜0xFEに収まるため、句読点を含む普通の文章でも
 * この関数は`true`を返す。そのファイルがGBKとしてU+FF5EやU+2116にデコードされる
 * バイト列(containsConvertTargetCharactersを通る条件)を含み、かつ
 * 0x8F 0xA2 0xB7 / 0x8F 0xA2 0xF1に一致するバイト列も含んでいた場合、
 * 変換対象ではないファイルを書き換えてしまう。
 * 逆方向の誤判定(正当なEUC-JPを取りこぼす)は無いことは確認済みで、
 * EUC-JPでラウンドトリップできるBMPの全文字がこの関数を通る。
 *
 * この穴は0.3系のencoding-japaneseによる判定にも同じように存在していたため
 * 新たに増えたリスクではないが、1.100.0以降ではこの関数自体を通らないため、
 * 「古いVS Codeでのみ起こりうる挙動の差」であることに注意
 * (この既知の穴はsrc/test/suite/extension.test.tsのisEUCJPBufferの
 *  テストベクタで明示的に固定してある)
 *
 * @param buffer 判定するバイト列
 * @returns `true`: EUC-JPとして妥当, `false`: EUC-JPとして解釈できないバイト列を含む
 */
export function isEUCJPBuffer(buffer: Buffer): boolean {
  let position = 0;

  while (position < buffer.length) {
    const byte = buffer[position];

    // while条件(position < buffer.length)により実際には到達しないが、
    // noUncheckedIndexedAccessを満たすために必要
    if (byte === undefined) {
      return false;
    }

    // ASCII(制御文字を含む)
    if (byte <= 0x7f) {
      position += 1;
      continue;
    }

    // 半角カナ: SS2 + 1バイト
    if (byte === SS2) {
      if (
        position + 1 >= buffer.length ||
        !isHalfwidthKatakanaByte(buffer[position + 1])
      ) {
        return false;
      }

      position += 2;
      continue;
    }

    // 補助漢字: SS3 + 2バイト
    if (byte === SS3) {
      if (
        position + 2 >= buffer.length ||
        !isDoubleByteRange(buffer[position + 1]) ||
        !isDoubleByteRange(buffer[position + 2])
      ) {
        return false;
      }

      position += 3;
      continue;
    }

    // JIS X 0208: 2バイト
    if (isDoubleByteRange(byte)) {
      if (
        position + 1 >= buffer.length ||
        !isDoubleByteRange(buffer[position + 1])
      ) {
        return false;
      }

      position += 2;
      continue;
    }

    // EUC-JPのどの並びにも当てはまらないバイト(0x80〜0x8D, 0x90〜0xA0, 0xFF)
    return false;
  }

  return true;
}

/**
 * ドキュメントの情報だけでEUC-JPかを判定する
 *
 * ディスクを読まないため、判定できない場合(VS Code 1.100.0未満)は`"unknown"`を返す
 *
 * @param document 判定するドキュメント
 * @returns `true`: EUC-JP, `false`: EUC-JP以外, `"unknown"`: バイト列を見ないと判定できない
 */
export function isEUCJPDocument(document: vscode.TextDocument): EucjpVerdict {
  // プロパティの有無で分岐する。値がstringかどうかでは分岐しないこと。
  // 「APIが無い(1.100.0未満)」と「APIはあるが値が取れなかった」を
  // 区別しないと、後者でバイト列の推定(isEUCJPBuffer)にフォールバックして
  // しまう。推定は他のマルチバイトエンコーディングを誤判定しうる安全でない側
  // なので、APIがある環境では値が取れなくても推定に落とさず、
  // 「EUC-JPではない」として変換しない側に倒す
  if (!("encoding" in document)) {
    return "unknown";
  }

  return (document as DocumentWithEncoding).encoding === EUCJP_ENCODING_ID;
}

/**
 * EUC-JPかの確定判定にディスク上のバイト列が要るかを判定する
 *
 * 呼び出し側が「ディスクを読む前にどこまで足切りできるか」を判断するために使う
 *
 * @param document 判定するドキュメント
 * @returns `true`: バイト列が要る(VS Code 1.100.0未満), `false`: ドキュメントだけで判定済み
 */
export function needsBytesToDecideEUCJP(
  document: vscode.TextDocument,
): boolean {
  return isEUCJPDocument(document) === "unknown";
}

/**
 * ディスクを読まずに「EUC-JPではない」と言い切れるかを判定する
 *
 * ディスクの読み込みより手前で使う足切り用の過剰近似。
 * VS Code 1.100.0未満では判定材料が無いため常に`true`を返す。
 * ファイルを書き換えてよいかの最終判断には必ず`isEUCJPConfirmed`を使うこと
 *
 * @param document 判定するドキュメント
 * @returns `true`: EUC-JPの可能性がある, `false`: 確実にEUC-JPではない
 */
export function canBeEUCJP(document: vscode.TextDocument): boolean {
  return isEUCJPDocument(document) !== false;
}

/**
 * ドキュメントとディスク上のバイト列からEUC-JPかを確定判定する
 *
 * ファイルを書き換えてよいかの最終判断に使う。
 * VS Code 1.100.0以降ではバイト列を見ずに`TextDocument.encoding`の結果を返す
 *
 * @param document 判定するドキュメント
 * @param content ディスクから読み込んだバイト列
 * @returns `true`: EUC-JP, `false`: EUC-JP以外
 */
export function isEUCJPConfirmed(
  document: vscode.TextDocument,
  content: Buffer,
): boolean {
  const verdict = isEUCJPDocument(document);

  return verdict === "unknown" ? isEUCJPBuffer(content) : verdict;
}
