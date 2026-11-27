//@ts-check
"use strict";

/**
 * 翻訳漏れをCIで検出する
 *
 * - l10n/bundle.l10n.json が src の l10n.t() と一致している(`npm run l10n-export`忘れ)
 * - package.json の %key% がすべて package.nls.json にある
 * - 各言語のファイルが英語版と同じキーを持ち、プレースホルダ({0}や${statusIcon})も一致している
 */

const fs = require("fs");
const path = require("path");
const { getL10nJson } = require("@vscode/l10n-dev");

const root = path.join(__dirname, "..");

/** @type {string[]} */
const errors = [];

/**
 * @param {string} file rootからの相対パス
 * @returns {Record<string, string | { message: string }>}
 */
function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
}

/**
 * @param {string | { message: string }} value
 * @returns {string}
 */
function messageOf(value) {
  return typeof value === "string" ? value : value.message;
}

/**
 * @param {string} message
 * @returns {string}
 */
function placeholdersOf(message) {
  return (message.match(/\{[^}]*\}/g) ?? []).sort().join(" ");
}

/**
 * 英語版(base)と各言語版で、キーとプレースホルダが一致しているか調べる
 *
 * @param {string} baseFile 英語版のファイル
 * @param {RegExp} localizedPattern 各言語版のファイル名
 */
function checkTranslations(baseFile, localizedPattern) {
  const base = readJson(baseFile);
  const dir = path.dirname(baseFile);

  const localizedFiles = fs
    .readdirSync(path.join(root, dir))
    .filter((name) => localizedPattern.test(name))
    .map((name) => path.join(dir, name));

  for (const file of localizedFiles) {
    const localized = readJson(file);

    for (const key of Object.keys(base)) {
      if (!(key in localized)) {
        errors.push(`${file}: 翻訳がありません: ${key}`);
      } else if (
        placeholdersOf(messageOf(base[key])) !==
        placeholdersOf(messageOf(localized[key]))
      ) {
        errors.push(`${file}: プレースホルダが英語版と違います: ${key}`);
      }
    }
    for (const key of Object.keys(localized)) {
      if (!(key in base)) {
        errors.push(`${file}: 英語版に無いキーです: ${key}`);
      }
    }
  }
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
function listTsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return listTsFiles(entryPath);
    }
    return entry.name.endsWith(".ts") ? [entryPath] : [];
  });
}

async function main() {
  // src から抽出した文言と l10n/bundle.l10n.json を比べる
  const extracted = await getL10nJson(
    listTsFiles(path.join(root, "src")).map((file) => ({
      extension: ".ts",
      contents: fs.readFileSync(file, "utf8"),
    })),
  );
  const bundle = readJson("l10n/bundle.l10n.json");
  if (JSON.stringify(extracted) !== JSON.stringify(bundle)) {
    errors.push(
      "l10n/bundle.l10n.json が src と一致しません。`npm run l10n-export` を実行してください",
    );
  }

  // package.json の %key% が package.nls.json にあるか調べる
  const nls = readJson("package.nls.json");
  const manifest = fs.readFileSync(path.join(root, "package.json"), "utf8");
  for (const [, key] of manifest.matchAll(/"%([^"%]+)%"/g)) {
    if (!(key in nls)) {
      errors.push(`package.nls.json: キーがありません: ${key}`);
    }
  }

  checkTranslations("package.nls.json", /^package\.nls\..+\.json$/);
  checkTranslations("l10n/bundle.l10n.json", /^bundle\.l10n\..+\.json$/);

  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
