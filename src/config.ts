import * as vscode from "vscode";
import { CONVERT_TARGETS, ConvertTarget } from "./convert";

/**
 * 拡張機能の設定の読み書き
 *
 * 設定のキーを知っているのはこのモジュールだけにする
 */

/** 設定のセクション名(package.jsonのcontributes.configuration) */
export const CONFIG_SECTION = "waveDashUnify";

function getConfig(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration(CONFIG_SECTION);
}

/**
 * 変換が有効かを返す(waveDashUnify.enableConvert)
 */
export function isConvertEnabled(): boolean {
  // package.jsonにdefaultがあるのでundefinedにはならないが、念のため変換しない側に倒す
  return getConfig().get<boolean>("enableConvert") ?? false;
}

/**
 * 変換の有効/無効をユーザー設定に保存する
 */
export async function setConvertEnabled(enabled: boolean): Promise<void> {
  await getConfig().update(
    "enableConvert",
    enabled,
    vscode.ConfigurationTarget.Global,
  );
}

/**
 * 設定で有効になっている変換対象を返す
 */
export function getEnabledTargets(): ConvertTarget[] {
  const config = getConfig();

  return CONVERT_TARGETS.filter(
    (target) => config.get<boolean>(target.configKey) === true,
  );
}

/**
 * ステータスバーの表示書式を返す(waveDashUnify.statusBarFormat)
 */
export function getStatusBarFormat(): string | undefined {
  return getConfig().get<string>("statusBarFormat");
}
