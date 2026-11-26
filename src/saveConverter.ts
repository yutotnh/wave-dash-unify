import * as vscode from "vscode";
import * as fs from "fs";
import { readConfig } from "./config";
import { createDebouncer, Debouncer } from "./debounce";
import { convertBytes, detectEncoding, isEucJpBuffer, Target } from "./eucjp";

/**
 * 保存後の変換
 *
 * 保存されたEUC-JPファイルをディスク上で書き換え、全角チルダなどを置き換える。
 *
 * 書き換えのタイミングには次の制約がある(issue #13):
 * - VS Codeが記録しているファイル状態(etag)とディスクがズレると、次の保存が
 *   「上書きに失敗しました」になる。書き換えた後はrevertでetagを同期する
 * - revertはアクティブエディタにしか効かない
 * - 未保存の編集があるときにrevertすると編集が失われる
 *
 * そのため、アクティブかつ未編集のときだけ変換し、それ以外は先送りする。
 * 先送りしたものは、次の保存・アクティブ化・クローズ・終了時に再判定する
 */

// 保存が続く間(Ctrl+S長押しなど)は書き換えず、落ち着いてから1回だけ変換する(ms)
export const SAVE_DEBOUNCE_MS = 300;

interface Pending {
  document: vscode.TextDocument;
  debouncer: Debouncer;
  /** アクティブでない、または未保存の編集があったため先送りした */
  postponed: boolean;
}

export interface SaveConverter {
  /** 保存されたドキュメントの変換を予約する */
  schedule: (document: vscode.TextDocument) => void;
  /** アクティブになったドキュメントに先送り中の変換があれば再判定する */
  resume: (document: vscode.TextDocument | undefined) => void;
  /**
   * 閉じられたドキュメントの変換待ちを変換する
   *
   * onDidCloseTextDocumentはタブを閉じても発火するとは限らない(APIドキュメントに明記)。
   * そのときはdisposeまで変換待ちのまま残る
   */
  convertOnClose: (document: vscode.TextDocument) => void;
  /** 変換待ちをすべて変換する。以降は保存が起きないので、未保存の編集があっても変換する */
  dispose: () => void;
}

export function createSaveConverter(): SaveConverter {
  /** 変換待ちのドキュメント(キー: URI文字列) */
  const pending = new Map<string, Pending>();

  function schedule(document: vscode.TextDocument) {
    if (document.uri.scheme !== "file" || !mayNeedConversion(document)) {
      return;
    }

    const key = document.uri.toString();
    let entry = pending.get(key);

    if (!entry) {
      const debouncer = createDebouncer(() => {
        attempt(key, false);
      }, SAVE_DEBOUNCE_MS);
      entry = { document, debouncer, postponed: false };
      pending.set(key, entry);
    }

    entry.document = document;
    entry.postponed = false;
    entry.debouncer.schedule();
  }

  /**
   * 変換してよいかを判定し、よければ変換する
   *
   * | 状態                 | 動作                     |
   * | -------------------- | ------------------------ |
   * | アクティブかつ未編集 | 変換してrevertで同期する |
   * | 閉じられた           | 変換する(同期は不要)   |
   * | 終了時(force)      | 変換する                 |
   * | それ以外             | 先送りする               |
   */
  function attempt(key: string, force: boolean) {
    const entry = pending.get(key);
    if (!entry) {
      return;
    }

    const { document } = entry;
    const canSync =
      !document.isClosed &&
      !document.isDirty &&
      vscode.window.activeTextEditor?.document === document;

    if (!canSync && !document.isClosed && !force) {
      entry.postponed = true;
      return;
    }

    entry.debouncer.cancel();
    pending.delete(key);

    if (convertFile(document) && canSync) {
      // 変換後のバイト列はデコードすると同じテキストになるので、
      // 再読込してもエディタの内容・カーソル位置・undo履歴は変わらない
      void vscode.commands
        .executeCommand("workbench.action.files.revert")
        .then(undefined, () => undefined);
    }
  }

  return {
    schedule,
    resume: (document) => {
      // 保存直後の待機中は、待機の満了時に判定する
      const key = document?.uri.toString();
      if (key !== undefined && pending.get(key)?.postponed) {
        attempt(key, false);
      }
    },
    convertOnClose: (document) => {
      attempt(document.uri.toString(), false);
    },
    dispose: () => {
      for (const key of [...pending.keys()]) {
        // 1件の失敗(ファイルが外部で消された場合など)で残りを止めない
        try {
          attempt(key, true);
        } catch {
          // 終了処理中なので、これ以上できることはない
        }
      }
    },
  };
}

/** 変換が有効なら、有効な変換対象を返す */
function activeTargets(): readonly Target[] {
  const { enabled, targets } = readConfig();

  return enabled ? targets : [];
}

/**
 * 保存直後のドキュメントが変換を必要としうるか
 *
 * 保存直後のテキストはディスクの内容と同じで、変換対象のバイト列を生むのは
 * 変換対象の文字だけなので、テキストに無ければディスクにも無い
 */
function mayNeedConversion(document: vscode.TextDocument): boolean {
  const targets = activeTargets();
  if (targets.length === 0 || detectEncoding(document) === "other") {
    return false;
  }

  const text = document.getText();

  return targets.some((t) => text.includes(t.char));
}

/**
 * ディスク上のファイルを読み、変換対象のバイト列があれば書き換える
 *
 * @returns `true`: ファイルを書き換えた
 */
function convertFile(document: vscode.TextDocument): boolean {
  // 予約後に設定やエンコーディングが変わっていることがあるので、もう一度確認する
  const targets = activeTargets();
  const encoding = detectEncoding(document);
  if (targets.length === 0 || encoding === "other") {
    return false;
  }

  const content = fs.readFileSync(document.fileName);
  const converted = convertBytes(content, targets);

  // 変換対象が無ければ同じBufferが返る
  if (converted === content) {
    return false;
  }

  // 1.100.0未満はファイル全体の走査になるので、変換対象があるときだけ行う
  if (encoding === "unknown" && !isEucJpBuffer(content)) {
    return false;
  }

  fs.writeFileSync(document.fileName, converted);

  return true;
}
