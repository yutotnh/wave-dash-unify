/**
 * 変換対象の定義と、文字列・バイト列の変換・判定
 *
 * VS Codeに依存しない純粋な処理だけを置く。設定やファイルI/Oは呼び出し側が扱う
 */

export const WAVE_DASH_CODE_POINT = 0x301c;
export const FULLWIDTH_TILDE_CODE_POINT = 0xff5e;
export const NUMERO_SIGN_CODE_POINT = 0x2116;

// いずれもサロゲートペアにならないため、1文字の文字列としてindexOfに渡せる
//
// WAVE_DASH_CHAR(U+301C)はEUC-JPのファイルには出現しない(VS CodeのEUC-JPコーデックは
// 0xA1 0xC1も0x8F 0xA2 0xB7もU+FF5Eにデコードするため。#635)。
// UTF-8のファイルではステータスバーで数えるので残している
const WAVE_DASH_CHAR = String.fromCodePoint(WAVE_DASH_CODE_POINT);
const FULLWIDTH_TILDE_CHAR = String.fromCodePoint(FULLWIDTH_TILDE_CODE_POINT);
const NUMERO_SIGN_CHAR = String.fromCodePoint(NUMERO_SIGN_CODE_POINT);

/**
 * 変換対象の一覧
 *
 * 文字での判定とバイト列の変換の両方がこの表を使う。対象を増やすときはここに追加する
 *
 * convertBytesが前提としている制約:
 * - fromはSS3(0x8F)で始まる
 * - to.length <= from.length
 */
export const CONVERT_TARGETS = [
  {
    char: FULLWIDTH_TILDE_CHAR,
    configKey: "fullwidthTildeToWaveDash",
    from: [0x8f, 0xa2, 0xb7], // 全角チルダ
    to: [0xa1, 0xc1], // 波ダッシュ
  },
  {
    char: NUMERO_SIGN_CHAR,
    configKey: "numeroSignToNumeroSign",
    from: [0x8f, 0xa2, 0xf1], // 全角NO(JIS X 0212)
    to: [0xad, 0xe2], // 全角NO(JIS X 0208)
  },
] as const;

export type ConvertTarget = (typeof CONVERT_TARGETS)[number];

/**
 * テキストに変換対象の文字が1つでも含まれるかを返す
 *
 * @param text 判定するテキスト
 * @param targets 変換対象
 */
export function containsTargetCharacters(
  text: string,
  targets: readonly ConvertTarget[],
): boolean {
  return targets.some((target) => text.includes(target.char));
}

/**
 * bufのpositionからbytesが並んでいるかを返す
 */
function matchesBytesAt(
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
 * @param targets 変換対象
 * @returns 変換後のバッファ。変換対象が無ければbufそのもの
 */
export function convertBytes(
  buf: Buffer,
  targets: readonly ConvertTarget[],
): Buffer {
  if (targets.length === 0) {
    return buf;
  }

  // 変換対象はすべてSS3で始まるので、SS3の位置だけをindexOfで探す
  const SS3 = 0x8f;

  let converted: Buffer | undefined;
  let writePos = 0; // convertedへの書き込み済み位置
  let copiedPos = 0; // bufのコピー済み位置
  let i = buf.indexOf(SS3);

  while (i !== -1) {
    const position = i;
    const target = targets.find((candidate) =>
      matchesBytesAt(buf, position, candidate.from),
    );

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

/**
 * strにtargetが何回出現するかを数える
 *
 * 大きな文字列でも速いよう、for...ofではなくネイティブのindexOfを使う
 */
function countOccurrences(str: string, target: string): number {
  let count = 0;
  let pos = str.indexOf(target);

  while (pos !== -1) {
    count++;
    pos = str.indexOf(target, pos + target.length);
  }

  return count;
}

/**
 * ステータスバーに表示する文字数を数える
 *
 * 全角チルダと波ダッシュは合算する
 *
 * @param str 数える文字列
 */
export function countTargetCharacters(str: string): {
  waveDashAndFullwidthTilde: number;
  numeroSign: number;
} {
  return {
    waveDashAndFullwidthTilde:
      countOccurrences(str, WAVE_DASH_CHAR) +
      countOccurrences(str, FULLWIDTH_TILDE_CHAR),
    numeroSign: countOccurrences(str, NUMERO_SIGN_CHAR),
  };
}
