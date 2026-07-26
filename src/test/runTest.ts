import * as path from "path";

import {
  runTests,
  downloadAndUnzipVSCode,
  TestOptions,
} from "@vscode/test-electron";

// yargs 18 は CJS 向け export を持たない ESM 専用パッケージになった。
// tsconfig.json の "module": "commonjs" のもとで `import yargs from "yargs"` や
// `await import("yargs")` を書くと、tsc はそれを `require("yargs")` に変換して
// しまい、Node の同期 require() では ESM を読み込めず ERR_REQUIRE_ESM で失敗する
// (Node 20.19 / 22.12 以降の require(esm) サポートがあれば動くこともあるが、
// 例えば .devcontainer/Dockerfile が使う node:20 系イメージのように、それより
// 古い Node ではこの方法は使えない)。
// `Function` 経由で import() を呼び出すことで tsc による書き換えを回避し、
// Node のバージョンに関わらず動作する本物の非同期 ESM import を発生させる。
const dynamicImport = new Function(
  "specifier",
  "return import(specifier);",
) as <T>(specifier: string) => Promise<T>;

/**
 * CLI 引数を解析してオプションを取得する
 * @returns {Object} CLI 引数のオプション
 */
async function parseCliArgs() {
  const { default: yargs } =
    await dynamicImport<typeof import("yargs")>("yargs");
  const { hideBin } =
    await dynamicImport<typeof import("yargs/helpers")>("yargs/helpers");

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

    const { vscodeVersion } = await parseCliArgs();
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
  } catch (err) {
    console.error("Failed to run tests", err);
    process.exit(1);
  }
}

main();
