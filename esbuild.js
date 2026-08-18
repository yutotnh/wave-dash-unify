//@ts-check
"use strict";

const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/**
 * VS Codeのタスクシステムが認識できるよう、ビルド開始/終了を
 * 標準的な形式でログ出力するプラグイン(tasks.jsonの$esbuild-watchが拾う)。
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
  name: "esbuild-problem-matcher",
  setup(build) {
    build.onStart(() => {
      console.log("[watch] build started");
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        if (location) {
          console.error(
            `    ${location.file}:${location.line.toString()}:${location.column.toString()}:`,
          );
        }
      });
      console.log("[watch] build finished");
    });
  },
};

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    // VS Code拡張機能のExtension Hostが動くNode.jsランタイム。
    // .nvmrcはmicrosoft/vscode自体のツールチェーン追従用で別物(AGENTS.md参照)。
    // 実行時floorはengines.vscode(package.json)が同梱するNode.jsバージョン。
    platform: "node",
    target: "node16",
    outfile: "dist/extension.js",
    // vscodeモジュールは拡張ホストが実行時に提供するため、バンドルせず外部化する。
    // 追加するモジュールは.vscodeignoreにも反映すること。
    external: ["vscode"],
    logLevel: "silent",
    plugins: [esbuildProblemMatcherPlugin],
  });
  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
