import * as vscode from "vscode";

/**
 * EUC-JPのバイト列に関すること
 *
 * 変換表、バイト列の置換、構造の検査、ドキュメントのエンコーディング判定を置く
 */

/** SS2: 半角カナ1文字を導入する */
const SS2 = 0x8e;

/** SS3: 補助漢字(JIS X 0212)1文字を導入する */
const SS3 = 0x8f;

/** 変換やステータスバーで扱う文字 */
export const CHARS = {
  waveDash: "〜",
  fullwidthTilde: "～",
  numeroSign: "№",
} as const;

/**
 * 変換対象の一覧。対象を増やすときはここに追加する
 *
 * convertBytesが前提としている制約:
 * - fromはSS3で始まる
 * - to.length <= from.length
 */
export const TARGETS = [
  {
    configKey: "fullwidthTildeToWaveDash",
    char: CHARS.fullwidthTilde,
    from: [SS3, 0xa2, 0xb7], // 全角チルダ
    to: [0xa1, 0xc1], // 波ダッシュ
  },
  {
    configKey: "numeroSignToNumeroSign",
    char: CHARS.numeroSign,
    from: [SS3, 0xa2, 0xf1], // 全角NO(JIS X 0212)
    to: [0xad, 0xe2], // 全角NO(JIS X 0208)
  },
] as const;

export type Target = (typeof TARGETS)[number];

/** bufのpositionからbytesが並んでいるか */
function matchesAt(
  buf: Buffer,
  position: number,
  bytes: readonly number[],
): boolean {
  if (position + bytes.length > buf.length) {
    return false;
  }

  for (let offset = 0; offset < bytes.length; offset++) {
    if (buf[position + offset] !== bytes[offset]) {
      return false;
    }
  }

  return true;
}

/**
 * バッファ中の変換対象のバイト列を置き換える
 *
 * @param buf 変換するバッファ(書き換えない)
 * @returns 変換後のバッファ。変換対象が無ければbufそのもの
 */
export function convertBytes(buf: Buffer, targets: readonly Target[]): Buffer {
  let converted: Buffer | undefined;
  let writePos = 0; // convertedへの書き込み済み位置
  let copiedPos = 0; // bufのコピー済み位置

  // 変換対象はすべてSS3で始まるので、SS3の位置だけを探す
  let i = buf.indexOf(SS3);

  while (i !== -1) {
    const position = i;
    const target = targets.find((t) => matchesAt(buf, position, t.from));

    if (target) {
      // to.length <= from.lengthなので、元の長さで足りる
      converted ??= Buffer.allocUnsafe(buf.length);
      writePos += buf.copy(converted, writePos, copiedPos, position);
      for (const byte of target.to) {
        converted[writePos++] = byte;
      }
      copiedPos = position + target.from.length;
      i = buf.indexOf(SS3, copiedPos);
    } else {
      i = buf.indexOf(SS3, position + 1);
    }
  }

  if (!converted) {
    return buf;
  }

  writePos += buf.copy(converted, writePos, copiedPos);

  return converted.subarray(0, writePos);
}

/** byteがlo〜hiの範囲内か(範囲外の添字でundefinedなら`false`) */
function inRange(byte: number | undefined, lo: number, hi: number): boolean {
  return byte !== undefined && byte >= lo && byte <= hi;
}

/**
 * バイト列がEUC-JPとして構造的に妥当か(1.100.0未満用)
 *
 * | 種別             | パターン                |
 * | ---------------- | ----------------------- |
 * | ASCII            | 0x00〜0x7F              |
 * | 半角カナ (SS2)   | 0x8E + 0xA1〜0xDF       |
 * | JIS X 0212 (SS3) | 0x8F + (0xA1〜0xFE) × 2 |
 * | JIS X 0208       | (0xA1〜0xFE) × 2        |
 *
 * 既知の限界: 構造しか見ないため、GBKやBig5など同じ構造のファイルも`true`になる。
 * 0.3系(encoding-japanese)にもあった穴で、テストベクタで固定してある
 */
export function isEucJpBuffer(buffer: Buffer): boolean {
  let i = 0;

  while (i < buffer.length) {
    const byte = buffer[i];

    // ASCIIは最も多いので先に抜ける(undefinedはwhile条件により起きない)
    if (byte === undefined || byte <= 0x7f) {
      i += 1;
    } else if (byte === SS2 && inRange(buffer[i + 1], 0xa1, 0xdf)) {
      i += 2;
    } else if (
      byte === SS3 &&
      inRange(buffer[i + 1], 0xa1, 0xfe) &&
      inRange(buffer[i + 2], 0xa1, 0xfe)
    ) {
      i += 3;
    } else if (
      inRange(byte, 0xa1, 0xfe) &&
      inRange(buffer[i + 1], 0xa1, 0xfe)
    ) {
      i += 2;
    } else {
      return false;
    }
  }

  return true;
}

/**
 * ドキュメントのエンコーディング
 *
 * `"unknown"`はバイト列を見ないと判定できないこと(1.100.0未満)を表す
 */
export type Encoding = "eucjp" | "other" | "unknown";

/**
 * ドキュメントの情報だけでEUC-JPかを判定する
 *
 * `TextDocument.encoding`は1.100.0で追加された。engines.vscodeを1.100.0以上に
 * 上げるときは、isEucJpBufferと`"unknown"`を消せばよい
 */
export function detectEncoding(document: vscode.TextDocument): Encoding {
  // 値ではなくプロパティの有無で分岐する。APIがあるのに値が取れない場合を
  // バイト列の推定(誤判定しうる側)に回さず、変換しない側に倒すため
  if (!("encoding" in document)) {
    return "unknown";
  }

  // @types/vscode 1.66.0にはencodingが無いので、型をここで補う
  const { encoding } = document as { encoding?: string };

  return encoding === "eucjp" ? "eucjp" : "other";
}
