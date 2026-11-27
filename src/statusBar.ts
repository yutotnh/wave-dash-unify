import * as vscode from "vscode";
import { readConfig } from "./config";
import { createDebouncer } from "./debounce";
import { CHARS } from "./eucjp";

// キー入力のたびに全文を数えないよう、この時間内の更新要求を1回にまとめる(ms)
const UPDATE_DEBOUNCE_MS = 200;

export interface StatusBar {
  /** すぐに表示を更新する(待機中の更新は破棄する) */
  update: () => void;
  /** 少し待ってから表示を更新する(キー入力向け) */
  scheduleUpdate: () => void;
  dispose: () => void;
}

/** ステータスバー項目を作って表示する */
export function createStatusBar(): StatusBar {
  // IDは付けない。付けないと拡張機能のIDが使われ、それで既に個別に非表示にできる。
  // 変えると、非表示にしている利用者の項目がまた表示されてしまう(#817)
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
  );
  item.name = "Wave Dash Unify";

  function update() {
    debouncer.cancel();

    // テキストエディタが無いときは数える対象が無いので、場所を空けるため隠す
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      item.hide();
      return;
    }

    const { enabled, statusBarFormat } = readConfig();
    item.text = renderStatusText(
      statusBarFormat,
      enabled,
      editor.document.getText(),
    );
    item.command = clickCommand(enabled);
    item.tooltip = enabled
      ? "Wave Dash Unify is enabled (click to disable)"
      : "Wave Dash Unify is disabled (click to enable)";
    item.show();
  }

  const debouncer = createDebouncer(update, UPDATE_DEBOUNCE_MS);

  update();

  return {
    update,
    scheduleUpdate: debouncer.schedule,
    dispose: () => {
      debouncer.cancel();
      item.dispose();
    },
  };
}

/** クリックで実行するコマンド。有効と無効を切り替える */
export function clickCommand(enabled: boolean): string {
  return enabled
    ? "waveDashUnify.disableConvert"
    : "waveDashUnify.enableConvert";
}

/**
 * ステータスバーの表示文字列を作る
 *
 * 同じ変数が複数回書かれていてもすべて置き換える。全角チルダと波ダッシュは合算する
 *
 * @param format 表示書式(statusBarFormat)
 * @param enabled 変換が有効か
 * @param text 数える対象のテキスト
 */
export function renderStatusText(
  format: string,
  enabled: boolean,
  text: string,
): string {
  const tildeCount =
    countOccurrences(text, CHARS.waveDash) +
    countOccurrences(text, CHARS.fullwidthTilde);

  return format
    .replaceAll("${statusIcon}", enabled ? "$(pass-filled)" : "$(error)")
    .replaceAll("${waveDashAndFullwidthTildeCount}", tildeCount.toString())
    .replaceAll(
      "${numeroSignCount}",
      countOccurrences(text, CHARS.numeroSign).toString(),
    );
}

/** textにcharが何回出現するか(大きな文字列でも速いようindexOfを使う) */
function countOccurrences(text: string, char: string): number {
  let count = 0;

  for (let i = text.indexOf(char); i !== -1; i = text.indexOf(char, i + 1)) {
    count++;
  }

  return count;
}
