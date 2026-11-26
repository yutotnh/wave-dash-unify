/**
 * 変換対象の定義と、文字列・バイト列に対する変換・判定処理
 *
 * VS Codeに依存しない純粋な処理だけを置く。設定の読み込みやファイルI/Oは
 * 呼び出し側(extension.ts)が行い、必要な値を引数で渡す
 */

export const WAVEDASH_CODE_POINT = 0x301c;
export const FULLWIDTH_TILDE_CODE_POINT = 0xff5e;
export const NUMERO_SIGN_CODE_POINT = 0x2116;

// countSpecificCharactersでString#indexOfを使うため、事前に1文字の文字列へ変換しておく
// (いずれもサロゲートペアにならないコードポイント)
//
// WAVE_DASH_CHAR(U+301C)はEUC-JPのファイルでは出現しない(VS CodeのEUC-JPコーデックは
// 波ダッシュ0xA1 0xC1も全角チルダ0x8F 0xA2 0xB7も等しくU+FF5Eにデコードし、逆に
// U+301Cはエンコードできず'?'になるため。issue #635。前提はeucjp-encoding-invariants.test.ts
// で固定してある)。ただしステータスバーのカウントはエンコーディングを問わず動くため、
// UTF-8のファイルではU+301Cが実際にカウントされる。この項を削除すると表示が変わるため残す
const WAVE_DASH_CHAR = String.fromCodePoint(WAVEDASH_CODE_POINT);
const FULLWIDTH_TILDE_CHAR = String.fromCodePoint(FULLWIDTH_TILDE_CODE_POINT);
const NUMERO_SIGN_CHAR = String.fromCodePoint(NUMERO_SIGN_CODE_POINT);

/**
 * 変換対象の一覧
 *
 * 「何を変換するか」の唯一の定義。Unicode文字での判定
 * (containsConvertTargetCharacters)とバイト列での変換
 * (replaceSpecificCharactersInBuffer)の両方をこのテーブルから駆動するため、
 * 増やすときはここに1エントリ追加するだけでよい
 *
 * 各エントリの制約(replaceSpecificCharactersInBufferの実装が依存している):
 * - fromはEUC-JPのSS3バイト(0x8F)で始まる(SS3の位置だけをindexOfで走査するため)
 * - to.length <= from.length(出力用Bufferを入力と同じ長さで確保するため)
 */
export const CONVERT_TARGETS = [
  {
    char: FULLWIDTH_TILDE_CHAR,
    configKey: "fullwidthTildeToWaveDash",
    from: [0x8f, 0xa2, 0xb7],
    to: [0xa1, 0xc1],
  },
  {
    char: NUMERO_SIGN_CHAR,
    configKey: "numeroSignToNumeroSign",
    from: [0x8f, 0xa2, 0xf1], // 全角NO(表示は同じだが下のtoとは異なるバイト列)
    to: [0xad, 0xe2], // 全角NO
  },
] as const;

export type ConvertTarget = (typeof CONVERT_TARGETS)[number];

/**
 * テキストに変換対象文字(targetsのchar)が1つでも含まれるかを判定する
 *
 * @param text 判定対象のテキスト
 * @param targets 変換対象(空配列なら常に`false`)
 * @returns `true`: 変換対象文字が1つ以上含まれる, `false`: 含まれない
 */
export function containsTargetCharacters(
  text: string,
  targets: readonly ConvertTarget[],
): boolean {
  return targets.some((target) => text.includes(target.char));
}

/**
 * バッファの指定位置がバイト列と一致するかを判定する
 *
 * @param str 検索対象のバッファ
 * @param position 比較を開始する位置
 * @param bytes 一致を確認するバイト列
 * @returns `true`: positionからbytesと一致する, `false`: 一致しない
 */
function matchesBytesAt(
  str: Buffer,
  position: number,
  bytes: readonly number[],
): boolean {
  if (position + bytes.length > str.length) {
    return false;
  }

  for (let offset = 0; offset < bytes.length; offset++) {
    if (str[position + offset] !== bytes[offset]) {
      return false;
    }
  }

  return true;
}

/**
 * 与えられたバッファ中の特定のバイト列を置き換えたバッファを返す
 *
 * 置き換える対象は引数のtargets(呼び出し側で設定により絞り込んだCONVERT_TARGETS)
 *
 * @param str 変換したいバッファ
 * @param targets 変換対象(空配列なら何もしない)
 * @returns 変換後のバッファ(変換対象が1つも無ければ引数のバッファそのもの)
 */
export function convertBytes(
  str: Buffer,
  targets: readonly ConvertTarget[],
): Buffer {
  if (targets.length === 0) {
    return str;
  }

  // 変換対象のバイト列はいずれもSS3で始まるため、ネイティブ実装で高速な
  // indexOfでSS3の位置だけを走査し、その候補位置でのみバイト列を比較する
  const SS3 = 0x8f; // EUC-JPのシングルシフト(SS3)バイト。変換対象の先頭バイト

  let converted: Buffer | undefined;
  let writePos = 0; // convertedへの書き込み済み位置
  let copiedPos = 0; // strのコピー済み位置
  let i = str.indexOf(SS3);

  while (i !== -1) {
    const position = i;
    const target = targets.find((candidate) =>
      matchesBytesAt(str, position, candidate.from),
    );

    if (target) {
      // to.length <= from.lengthのため、変換後は元の長さを超えない
      converted ??= Buffer.allocUnsafe(str.length);

      writePos += str.copy(converted, writePos, copiedPos, position);
      for (const byte of target.to) {
        converted[writePos++] = byte;
      }
      copiedPos = position + target.from.length;
      i = str.indexOf(SS3, copiedPos);
    } else {
      i = str.indexOf(SS3, position + 1);
    }
  }

  // 変換対象が1つもなければ、入力のBufferをそのまま返す
  if (!converted) {
    return str;
  }

  writePos += str.copy(converted, writePos, copiedPos);

  return converted.subarray(0, writePos);
}

/**
 * 文字列中に指定した1文字(target)が何回出現するかを数える
 *
 * String#indexOfはネイティブ実装のため、for...ofによるコードポイント走査より高速
 * (10MB級の文字列で計測したところ、本関数を使う実装はfor...of実装の1/10程度の時間で完了した)
 *
 * @param str 検索対象の文字列
 * @param target 検索する1文字
 * @returns targetの出現回数
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
 * 全角チルダ、波ダッシュ、およびNUMERO SIGNの個数を数える
 *
 * 全角チルダと波ダッシュは同じ文字として扱う
 *
 * EUC-JPのファイルではWAVE_DASH_CHAR(U+301C)の項が常に0件になり、
 * 変換の前後でこのカウントは変化しない。理由と、それでも項を残している
 * 判断についてはWAVE_DASH_CHARの定義箇所のコメントを参照
 *
 * @param str 文字列
 * @returns 各文字の個数を含む辞書
 */
export function countSpecificCharacters(str: string): {
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
