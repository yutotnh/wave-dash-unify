import * as vscode from "vscode";

/**
 * EUC-JPの判定
 *
 * VS CodeのバージョンによるAPIの違いはこのモジュールの中だけで扱う
 *
 * - 1.100.0以降: `TextDocument.encoding`を見る。ディスクを読まずに確定でき、
 *   「エンコード付きで再度開く」での指定も反映される
 * - 1.100.0未満: `encoding`が無いので、ディスク上のバイト列を構造的に検査する
 *
 * 分岐はバージョン番号ではなくAPIの有無で行う。engines.vscodeを1.100.0以上に
 * 上げるときは、isEUCJPBufferと"unknown"の分岐を消せばよい
 */

/** `encoding`(1.100.0で追加)は@types/vscode 1.66.0に無いので、型をここで補う */
type DocumentWithEncoding = vscode.TextDocument & {
  readonly encoding?: string;
};

/** VS CodeがEUC-JPに使うエンコーディングID */
const EUCJP_ENCODING_ID = "eucjp";

/** SS2: 半角カナ1文字を導入する */
const SS2 = 0x8e;

/** SS3: 補助漢字(JIS X 0212)1文字を導入する */
const SS3 = 0x8f;

/** `"unknown"`はバイト列を見ないと判定できないこと(1.100.0未満のみ)を表す */
export type EucjpVerdict = true | false | "unknown";

/** 2バイト文字を構成するバイト(0xA1〜0xFE)か */
function isDoubleByteRange(byte: number): boolean {
  return byte >= 0xa1 && byte <= 0xfe;
}

/** SS2に続く半角カナのバイト(0xA1〜0xDF)か */
function isHalfwidthKatakanaByte(byte: number): boolean {
  return byte >= 0xa1 && byte <= 0xdf;
}

/**
 * バイト列がEUC-JPとして構造的に妥当かを返す(1.100.0未満用)
 *
 * 受け付ける並び:
 *
 * | 種別             | パターン                |
 * | ---------------- | ----------------------- |
 * | ASCII            | 0x00〜0x7F              |
 * | 半角カナ (SS2)   | 0x8E + 0xA1〜0xDF       |
 * | JIS X 0212 (SS3) | 0x8F + (0xA1〜0xFE) × 2 |
 * | JIS X 0208       | (0xA1〜0xFE) × 2        |
 *
 * ASCIIだけのファイルも`true`になるが、変換対象はSS3で始まるので書き換わらない
 *
 * 0.3系で使っていたencoding-japaneseのisEUCJPと違い、SS3の2バイト目を0xA2〜0xEDに
 * 絞らない(JIS X 0212の1区は実在するため)。変換対象(いずれも2区)の判定は同じ
 *
 * 既知の限界: 構造しか見ないため、GBKやBig5など同じバイト構造のファイルも
 * `true`になる。0.3系(encoding-japanese)にもあった穴で、1.100.0以降では
 * この関数を通らない。この穴はextension.test.tsのテストベクタで固定してある
 *
 * @param buffer 判定するバイト列
 */
export function isEUCJPBuffer(buffer: Buffer): boolean {
  let position = 0;

  while (position < buffer.length) {
    const byte = buffer[position];

    // noUncheckedIndexedAccessのため。while条件により実際には到達しない
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
      const next = buffer[position + 1];
      if (next === undefined || !isHalfwidthKatakanaByte(next)) {
        return false;
      }

      position += 2;
      continue;
    }

    // 補助漢字: SS3 + 2バイト
    if (byte === SS3) {
      const next1 = buffer[position + 1];
      const next2 = buffer[position + 2];
      if (
        next1 === undefined ||
        next2 === undefined ||
        !isDoubleByteRange(next1) ||
        !isDoubleByteRange(next2)
      ) {
        return false;
      }

      position += 3;
      continue;
    }

    // JIS X 0208: 2バイト
    if (isDoubleByteRange(byte)) {
      const next = buffer[position + 1];
      if (next === undefined || !isDoubleByteRange(next)) {
        return false;
      }

      position += 2;
      continue;
    }

    // どの並びにも当てはまらない(0x80〜0x8D, 0x90〜0xA0, 0xFF)
    return false;
  }

  return true;
}

/**
 * ドキュメントの情報だけでEUC-JPかを判定する
 *
 * @param document 判定するドキュメント
 * @returns 1.100.0未満では`"unknown"`
 */
export function isEUCJPDocument(document: vscode.TextDocument): EucjpVerdict {
  // 値ではなくプロパティの有無で分岐する。APIがあるのに値が取れない場合まで
  // バイト列の推定(誤判定しうる側)に回さず、変換しない側に倒すため
  if (!("encoding" in document)) {
    return "unknown";
  }

  return (document as DocumentWithEncoding).encoding === EUCJP_ENCODING_ID;
}

/**
 * EUC-JPの可能性があるか(ディスクを読む前の足切り用)
 *
 * 1.100.0未満では常に`true`。書き換えてよいかの判断にはisEUCJPConfirmedを使う
 */
export function canBeEUCJP(document: vscode.TextDocument): boolean {
  return isEUCJPDocument(document) !== false;
}

/**
 * ドキュメントとディスク上のバイト列から、EUC-JPかを確定する
 *
 * 書き換えてよいかの最終判断に使う
 *
 * @param document 判定するドキュメント
 * @param content ディスクから読んだバイト列
 */
export function isEUCJPConfirmed(
  document: vscode.TextDocument,
  content: Buffer,
): boolean {
  const verdict = isEUCJPDocument(document);

  return verdict === "unknown" ? isEUCJPBuffer(content) : verdict;
}
