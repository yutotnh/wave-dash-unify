import * as l10n from "@vscode/l10n";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { logError } from "./log";

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
 * 表示言語の訳を`@vscode/l10n`に読み込む。`setupLog`の後、最初の`l10n.t()`より前に呼ぶこと
 *
 * - VS Code 1.73.0以降: package.jsonの`l10n`を見てVS Code自身が読み込んだ
 *   `vscode.l10n.bundle`を渡す
 * - VS Code 1.73.0未満: `vscode.l10n`が無いため、`loadBundleFile`で自分で読む
 *
 * `@vscode/l10n`のREADMEは拡張機能本体では`vscode.l10n`を使うよう勧めているが、
 * 1.73.0未満を支えるには両方の経路で同じ`l10n.t()`を呼ぶ必要があるため、こちらに統一する。
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
 * `l10n/bundle.l10n.<言語>.json`を読み込む(VS Code 1.73.0未満用)
 *
 * 1.73.0以降と表示が変わらないよう、VS Codeと同じく表示言語のファイルだけを探す。
 * 無い、または読めない場合は、`l10n.t()`が英語の原文を返す
 *
 * @param extensionPath 拡張機能のインストール先
 * @param language VS Codeの表示言語(`vscode.env.language`)
 */
export function loadBundleFile(extensionPath: string, language: string) {
  const file = path.join(extensionPath, "l10n", `bundle.l10n.${language}.json`);
  if (!fs.existsSync(file)) {
    return;
  }

  try {
    l10n.config({ fsPath: file });
  } catch (error) {
    // 翻訳が読めないだけで変換機能まで止めないよう、英語表示のまま続ける
    logError(`Failed to load ${file}`, error);
  }
}
