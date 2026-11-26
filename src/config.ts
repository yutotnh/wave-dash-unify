import * as vscode from "vscode";
import { Target, TARGETS } from "./eucjp";

/** 設定のセクション名(package.jsonのcontributes.configuration) */
export const CONFIG_SECTION = "waveDashUnify";

export interface Config {
  /** 変換が有効か(enableConvert) */
  enabled: boolean;
  /** 個別の設定で有効な変換対象 */
  targets: Target[];
  /** ステータスバーの表示書式(statusBarFormat) */
  statusBarFormat: string;
}

/**
 * 設定を読む
 *
 * package.jsonにdefaultがあるので`??`の右辺は使われないが、念のため変換しない側に倒す
 */
export function readConfig(): Config {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);

  return {
    enabled: config.get<boolean>("enableConvert") ?? false,
    targets: TARGETS.filter((t) => config.get<boolean>(t.configKey) === true),
    statusBarFormat: config.get<string>("statusBarFormat") ?? "",
  };
}

/** 変換の有効/無効をユーザー設定に保存する */
export async function setEnabled(enabled: boolean): Promise<void> {
  await vscode.workspace
    .getConfiguration(CONFIG_SECTION)
    .update("enableConvert", enabled, vscode.ConfigurationTarget.Global);
}
