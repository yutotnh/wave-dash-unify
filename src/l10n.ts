import * as l10n from "@vscode/l10n";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

/**
 * 表示言語に合う翻訳バンドルを読み込む。最初の`l10n.t()`より前に呼ぶこと
 *
 * 公式の`vscode.l10n`はVS Code 1.73.0で追加されたAPIで、最低対応の1.66.0では使えない。
 * そのため`l10n/`のバンドルを自分で選び、`@vscode/l10n`に渡す。
 * `engines.vscode`を1.73.0以上に上げたら、このファイルと`@vscode/l10n`を消し、
 * `l10n.t`を`vscode.l10n.t`に置き換えればよい
 *
 * 対応するバンドルが無い言語(英語を含む)では何もせず、`l10n.t()`は英語の原文を返す
 *
 * @param extensionPath 拡張機能のインストール先
 */
export function setupL10n(extensionPath: string) {
  const file = bundleFileNames(vscode.env.language)
    .map((name) => path.join(extensionPath, "l10n", name))
    .find((file) => fs.existsSync(file));

  if (file !== undefined) {
    l10n.config({ fsPath: file });
  }
}

/**
 * 表示言語に対応するバンドルのファイル名を、優先する順に返す
 *
 * VS Codeの言語IDは`ja`や`zh-cn`のような形式。`zh-cn`のバンドルが無ければ
 * `zh`を使えるよう、基底言語も候補に入れる
 *
 * @param language VS Codeの表示言語(`vscode.env.language`)
 * @returns バンドルのファイル名の候補
 */
export function bundleFileNames(language: string): string[] {
  const full = language.toLowerCase();
  const base = full.replace(/-.*/, "");
  const languages = full === base ? [full] : [full, base];

  return languages.map((lang) => `bundle.l10n.${lang}.json`);
}
