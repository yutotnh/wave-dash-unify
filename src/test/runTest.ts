import * as path from "path";

import {
  runTests,
  downloadAndUnzipVSCode,
  TestOptions,
} from "@vscode/test-electron";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

/**
 * CLI 引数を解析してオプションを取得する
 * @returns {Object} CLI 引数のオプション
 */
function parseCliArgs() {
  const argv = yargs(hideBin(process.argv))
    .option("vscode-version", {
      type: "string",
      description: "VS Code のバージョンを指定",
    })
    .help("help")
    .alias("help", "h")
    .parseSync();

  return {
    vscodeVersion:
      typeof argv.vscodeVersion === "string" ? argv.vscodeVersion : undefined,
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
    console.log(`Using VS Code version: ${vscodeVersion}`);
    if (vscodeVersion) {
      // 指定バージョンのキャッシュがあれば再利用し、なければダウンロード
      const execPath = await downloadAndUnzipVSCode(vscodeVersion);
      console.log(`VS Code executable path: ${execPath}`);
      options.vscodeExecutablePath = execPath;
    }

    await runTests(options);
  } catch (err) {
    console.error("Failed to run tests", err);
    process.exit(1);
  }
}

main();
