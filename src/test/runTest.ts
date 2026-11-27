import * as path from "path";
import { parseArgs } from "node:util";

import {
  runTests,
  downloadAndUnzipVSCode,
  TestOptions,
} from "@vscode/test-electron";
import { TEST_LOCALE_ENV } from "./suite/locale";

/**
 * CLI 引数を解析してオプションを取得する
 * @returns {Object} CLI 引数のオプション
 */
function parseCliArgs() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      // CLI フラグ名 (--vscode-version) は kebab-case である必要があるため、
      // camelCase を要求する naming-convention の対象から除外する。
      // eslint-disable-next-line @typescript-eslint/naming-convention
      "vscode-version": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(
      [
        "Usage: npm test -- [options]",
        "",
        "Options:",
        "  --vscode-version <version>  VS Code のバージョンを指定",
        "  -h, --help                  ヘルプを表示",
      ].join("\n"),
    );
    process.exit(0);
  }

  return {
    vscodeVersion: values["vscode-version"],
  };
}

async function main() {
  try {
    // The folder containing the Extension Manifest package.json
    // Passed to `--extensionDevelopmentPath`
    const extensionDevelopmentPath = path.resolve(__dirname, "../../");

    // The path to test runner
    // Passed to --extensionTestsPath
    const extensionTestsPath = path.resolve(__dirname, "./suite/index");

    const { vscodeVersion } = parseCliArgs();
    const options: TestOptions = {
      extensionDevelopmentPath,
      extensionTestsPath,
    };
    if (vscodeVersion) {
      // 指定バージョンのキャッシュがあれば再利用し、なければダウンロード
      const execPath = await downloadAndUnzipVSCode(vscodeVersion);
      options.vscodeExecutablePath = execPath;
    }

    await runTests(options);

    // 表示言語ごとの訳の読み込みを確かめるため、日本語でもう一度起動する。
    // 対象はsuite/index.tsが*.locale.test.jsだけに絞る
    await runTests({
      ...options,
      launchArgs: ["--locale=ja"],
      extensionTestsEnv: { [TEST_LOCALE_ENV]: "ja" },
    });
  } catch (err) {
    console.error("Failed to run tests", err);
    process.exit(1);
  }
}

void main();
