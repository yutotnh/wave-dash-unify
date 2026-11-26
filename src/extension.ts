import * as vscode from "vscode";
import { CONFIG_SECTION, setConvertEnabled } from "./config";
import { createSaveConverter } from "./saveConverter";
import { createStatusBar } from "./statusBar";

// deactivateは定義しない。終了時の処理(変換待ちの変換、ステータスバーの破棄)は
// context.subscriptionsに登録したもののdisposeで行われる
export function activate(context: vscode.ExtensionContext) {
  const statusBar = createStatusBar();
  const saveConverter = createSaveConverter();

  async function setEnabledAndUpdateStatusBar(enabled: boolean) {
    await setConvertEnabled(enabled);
    statusBar.update();
  }

  context.subscriptions.push(
    vscode.Disposable.from(
      statusBar,
      saveConverter,
      vscode.commands.registerCommand("waveDashUnify.enableConvert", () =>
        setEnabledAndUpdateStatusBar(true),
      ),
      vscode.commands.registerCommand("waveDashUnify.disableConvert", () =>
        setEnabledAndUpdateStatusBar(false),
      ),
      vscode.commands.registerCommand(
        "waveDashUnify.SelectEnableOrDisable",
        async () => {
          const picked = await vscode.window.showQuickPick([
            { label: "Enable convert", enabled: true },
            { label: "Disable convert", enabled: false },
          ]);

          if (picked) {
            await setEnabledAndUpdateStatusBar(picked.enabled);
          }
        },
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
    ),
  );
}
