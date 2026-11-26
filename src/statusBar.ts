import * as vscode from "vscode";
import { getStatusBarFormat, isConvertEnabled } from "./config";
import { countSpecificCharacters } from "./convert";
import { createDebouncer } from "./debounce";

// キー入力のたびに全文を数えないよう、この時間内の更新要求を1回にまとめる(ms)
const UPDATE_DEBOUNCE_MS = 200;

/**
 * 拡張機能のステータスバー項目
 */
export interface StatusBar {
  /** すぐに表示を更新する(待機中の更新は破棄する) */
  update: () => void;
  /** 少し待ってから表示を更新する(キー入力向け) */
  scheduleUpdate: () => void;
  dispose: () => void;
}

/**
 * ステータスバー項目を作って表示する
 */
export function createStatusBar(): StatusBar {
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
  );
  item.name = "Wave Dash Unify";
  item.command = "waveDashUnify.SelectEnableOrDisable";

  const debouncer = createDebouncer(() => {
    updateStatusBarItem(item);
  }, UPDATE_DEBOUNCE_MS);

  updateStatusBarItem(item);

  return {
    update: () => {
      debouncer.cancel();
      updateStatusBarItem(item);
    },
    scheduleUpdate: debouncer.schedule,
    dispose: () => {
      debouncer.cancel();
      item.dispose();
    },
  };
}

/**
 * 変換の有効/無効と対象文字の数をステータスバー項目に表示する
 *
 * @param item 表示先のステータスバー項目
 */
export function updateStatusBarItem(item: vscode.StatusBarItem) {
  // package.jsonにdefaultがあるのでundefinedにはならない
  const format = getStatusBarFormat();
  if (format === undefined) {
    return;
  }

  // テキストエディタが無いときは数える対象が無いので、場所を空けるため隠す
  const activeEditor = vscode.window.activeTextEditor;
  if (!activeEditor) {
    item.hide();
    return;
  }

  item.show();

  const isEnabled = isConvertEnabled();
  item.tooltip = isEnabled
    ? "Wave Dash Unify is enabled"
    : "Wave Dash Unify is disabled";

  const count = countSpecificCharacters(activeEditor.document.getText());

  // 同じ変数が複数回書かれていてもすべて置き換える
  item.text = format
    .replaceAll("${statusIcon}", isEnabled ? "$(pass-filled)" : "$(error)")
    .replaceAll(
      "${waveDashAndFullwidthTildeCount}",
      count.waveDashAndFullwidthTilde.toString(),
    )
    .replaceAll("${numeroSignCount}", count.numeroSign.toString());
}
