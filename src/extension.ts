import * as vscode from "vscode";
import { CONFIG_SECTION, setConvertEnabled } from "./config";
import {
  convertAllPending,
  convertOnClose,
  resumeConversion,
  scheduleConversion,
} from "./saveConverter";
import { createStatusBar } from "./statusBar";

export function activate(context: vscode.ExtensionContext) {
  const statusBar = createStatusBar();

  async function setEnabledAndUpdateStatusBar(enabled: boolean) {
    await setConvertEnabled(enabled);
    statusBar.update();
  }

  context.subscriptions.push(
    vscode.Disposable.from(
      statusBar,
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
      vscode.workspace.onDidSaveTextDocument(scheduleConversion),
      vscode.workspace.onDidCloseTextDocument(convertOnClose),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        statusBar.update();
        resumeConversion(editor?.document);
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

export function deactivate() {
  convertAllPending();
}
