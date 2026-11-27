import * as vscode from "vscode";
import { CONFIG_SECTION, setEnabled } from "./config";
import { createSaveConverter } from "./saveConverter";
import { createStatusBar } from "./statusBar";

// deactivateは定義しない。終了時の処理(変換待ちの変換、ステータスバーの破棄)は
// context.subscriptionsに登録したもののdisposeで行われる
export function activate(context: vscode.ExtensionContext) {
  const statusBar = createStatusBar();
  const saveConverter = createSaveConverter();

  context.subscriptions.push(
    statusBar,
    saveConverter,
    // ステータスバーは設定変更のイベントで更新される
    vscode.commands.registerCommand("waveDashUnify.enableConvert", () =>
      setEnabled(true),
    ),
    vscode.commands.registerCommand("waveDashUnify.disableConvert", () =>
      setEnabled(false),
    ),
    vscode.workspace.onDidSaveTextDocument(saveConverter.schedule),
    vscode.workspace.onDidCloseTextDocument(saveConverter.convertOnClose),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      statusBar.update();
      saveConverter.resume(editor?.document);
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      // 出力チャンネルなど、アクティブエディタ以外の変更は表示に影響しない
      if (e.document === vscode.window.activeTextEditor?.document) {
        statusBar.scheduleUpdate();
      }
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CONFIG_SECTION)) {
        statusBar.update();
      }
    }),
  );
}
