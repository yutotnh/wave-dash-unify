import * as l10n from "@vscode/l10n";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

/**
 * `vscode`のうち`setupL10n`が使う部分の型(テストで差し替えるため)
 *
 * `l10n`はVS Code 1.73.0で追加されたAPIで、`@types/vscode`(1.66.0)には無いため自分で書く
 */
export interface L10nHost {
  env: { language: string };
  l10n?: { bundle: l10n.l10nJsonFormat | undefined };
}

/**
 * 表示言語の訳を`@vscode/l10n`に読み込む。最初の`l10n.t()`より前に呼ぶこと
 *
 * - VS Code 1.73.0以降: package.jsonの`l10n`を見てVS Code自身が読み込んだ
 *   `vscode.l10n.bundle`を渡す(`@vscode/l10n`のREADMEが勧める使い方)
 * - VS Code 1.73.0未満: `vscode.l10n`が無いため、`loadBundleFile`で自分で読む
 *
 * `engines.vscode`を1.73.0以上に上げたら、このファイルと`@vscode/l10n`を消し、
 * `l10n.t`を`vscode.l10n.t`に置き換えればよい
 *
 * @param extensionPath 拡張機能のインストール先
 * @param host `vscode`モジュール(テスト用。省略時は本物)
 */
export function setupL10n(extensionPath: string, host: L10nHost = vscode) {
  if (host.l10n === undefined) {
    loadBundleFile(extensionPath, host.env.language);
    return;
  }

  // 訳の無い言語(英語を含む)ではbundleがundefinedになり、英語の原文を表示する
  l10n.config({ contents: host.l10n.bundle ?? {} });
}

/**
 * `l10n/`から表示言語のバンドルを探して読み込む(VS Code 1.73.0未満用)
 *
 * 対応するバンドルが無い、または読めない場合は、`l10n.t()`が英語の原文を返す
 *
 * @param extensionPath 拡張機能のインストール先
 * @param language VS Codeの表示言語(`vscode.env.language`)
 */
export function loadBundleFile(extensionPath: string, language: string) {
  // 前回読み込んだバンドルを残さない
  l10n.config({ contents: {} });

  const file = bundleFileNames(language)
    .map((name) => path.join(extensionPath, "l10n", name))
    .find((file) => fs.existsSync(file));

  if (file === undefined) {
    return;
  }

  try {
    l10n.config({ fsPath: file });
  } catch (error) {
    // 翻訳が読めないだけで変換機能まで止めないよう、英語表示のまま続ける
    console.error(`Wave Dash Unify: failed to load ${file}`, error);
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
