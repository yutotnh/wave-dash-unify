import * as vscode from "vscode";

let channel: vscode.OutputChannel | undefined;

/**
 * 出力パネルに「Wave Dash Unify」を作る。activateの最初に呼ぶこと
 *
 * 処理は続けるが失敗は残したい箇所のための記録先。不具合報告のときに
 * 利用者が内容を貼れるよう、開発者ツールではなく出力パネルに出す。
 * ログレベル付きのLogOutputChannelはVS Code 1.74.0以降のため使わない
 *
 * @param context 拡張機能のコンテキスト(終了時にチャンネルを破棄する)
 */
export function setupLog(context: vscode.ExtensionContext) {
  channel = vscode.window.createOutputChannel("Wave Dash Unify");
  context.subscriptions.push(channel);
}

/**
 * エラーを出力パネルに記録する。setupLogより前に呼ばれた場合は何もしない
 *
 * @param message 何に失敗したか
 * @param error 捕捉したエラー
 */
export function logError(message: string, error: unknown) {
  channel?.appendLine(
    `[${new Date().toISOString()}] ${message}: ${formatError(error)}`,
  );
}

/**
 * エラーを1つの文字列にする。スタックトレースがあればそれを使う
 *
 * @param error 捕捉したエラー(Error以外が投げられることもある)
 * @returns 記録用の文字列
 */
export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }
  return String(error);
}
