/**
 * 日本語で起動したテストであることを伝える環境変数(runTest.tsが設定する)
 *
 * この値があるときは*.locale.test.jsだけを、無いときはそれ以外を実行する
 */
export const TEST_LOCALE_ENV = "WAVE_DASH_UNIFY_TEST_LOCALE";

/**
 * このテストファイルを今回の起動で実行するか
 *
 * @param fileName テストファイル名
 * @returns `true`: 実行する
 */
export function isTargetTestFile(fileName: string): boolean {
  const isLocaleTest = fileName.endsWith(".locale.test.js");
  return process.env[TEST_LOCALE_ENV] === undefined
    ? !isLocaleTest
    : isLocaleTest;
}
