import * as vscode from "vscode";
import * as fs from "fs";
import { getEnabledTargets, isConvertEnabled } from "./config";
import { containsTargetCharacters, convertBytes } from "./convert";
import { createDebouncer, Debouncer } from "./debounce";
import { canBeEUCJP, isEUCJPConfirmed, isEUCJPDocument } from "./eucjp";

/**
 * 保存後の変換
 *
 * 保存されたEUC-JPファイルをディスク上で書き換え、全角チルダなどを置き換える。
 *
 * 書き換えのタイミングには次の制約がある(issue #13):
 * - VS Codeが記録しているファイル状態(etag)とディスクがズレると、次の保存が
 *   「上書きに失敗しました」になる。書き換えた後はrevertでetagを同期する
 * - revertはアクティブエディタにしか効かない。非アクティブなタブはディスクを
 *   書き換えても再読込されない(実測)
 * - 未保存の編集があるときにrevertすると編集が失われる
 *
 * そのため、アクティブかつ未編集のときだけ変換し、それ以外は先送りする。
 * 先送りしたものは、次の保存・アクティブ化・クローズ・終了時(dispose)に再判定する
 */

// 保存が続く間(Ctrl+S長押しなど)は書き換えず、落ち着いてから1回だけ変換する(ms)。
// キーリピートの間隔(数十ms)より長く、人が次に保存するまでの間隔より短い経験値
export const SAVE_CONVERSION_DEBOUNCE_MS = 300;

type Trigger = "debounced" | "activated" | "closed" | "dispose";

interface PendingConversion {
  document: vscode.TextDocument;
  debouncer: Debouncer;
  /** アクティブでない、または未保存の編集があったため先送りした */
  postponed: boolean;
}

/**
 * 保存後の変換
 */
export interface SaveConverter {
  /** 保存されたドキュメントの変換を予約する */
  schedule: (document: vscode.TextDocument) => void;
  /** アクティブになったドキュメントに先送り中の変換があれば再判定する */
  resume: (document: vscode.TextDocument | undefined) => void;
  /**
   * 閉じられたドキュメントに変換待ちがあれば変換する
   *
   * onDidCloseTextDocumentはタブを閉じても発火するとは限らない(APIドキュメントに明記)。
   * そのため、破棄されるかdisposeされるまで変換待ちのまま残ることがある
   */
  convertOnClose: (document: vscode.TextDocument) => void;
  /** 変換待ちをすべて変換する。以降は保存が起きないので、未保存の編集があっても変換する */
  dispose: () => void;
}

export function createSaveConverter(): SaveConverter {
  /** 変換待ちのドキュメント(キー: URI文字列) */
  const pending = new Map<string, PendingConversion>();

  function schedule(document: vscode.TextDocument) {
    if (document.uri.scheme !== "file") {
      return;
    }

    if (!isConvertEnabled() || !canBeEUCJP(document)) {
      return;
    }

    // 1.100.0未満はcanBeEUCJPが常にtrueなので、対象文字が無いファイルまで
    // 予約してクローズ時にディスクを読まないよう、ここで足切りする
    if (
      isEUCJPDocument(document) === "unknown" &&
      !containsConvertTargetCharacters(document)
    ) {
      return;
    }

    const key = document.uri.toString();
    const entry = pending.get(key);

    if (entry) {
      entry.document = document;
      entry.postponed = false;
      entry.debouncer.schedule();
      return;
    }

    const debouncer = createDebouncer(() => {
      attempt(key, "debounced");
    }, SAVE_CONVERSION_DEBOUNCE_MS);
    pending.set(key, { document, debouncer, postponed: false });
    debouncer.schedule();
  }

  /**
   * 変換してよいかを判定し、よければ変換する
   *
   * | 状態                 | 動作                       |
   * | -------------------- | -------------------------- |
   * | アクティブかつ未編集 | 変換してrevertで同期する   |
   * | 破棄済み             | 変換する(同期は不要)     |
   * | dispose中            | 変換する(同期は可能なら) |
   * | それ以外             | 先送りする                 |
   */
  function attempt(key: string, trigger: Trigger) {
    const entry = pending.get(key);
    if (!entry) {
      return;
    }

    // 保存直後の待機中は、待機の満了時に判定する
    if (trigger === "activated" && !entry.postponed) {
      return;
    }

    const { document } = entry;
    const canSync =
      !document.isClosed &&
      !document.isDirty &&
      vscode.window.activeTextEditor?.document === document;
    const mustConvertNow = document.isClosed || trigger === "dispose";

    if (!canSync && !mustConvertNow) {
      entry.postponed = true;
      return;
    }

    entry.debouncer.cancel();
    pending.delete(key);

    // 未編集ならテキストは保存内容と同じなので、テキストで足切りできる
    const written = convertFile(document, canSync);

    if (written) {
      void syncEditorWithConvertedFile(document);
    }
  }

  return {
    schedule,
    resume: (document) => {
      if (document) {
        attempt(document.uri.toString(), "activated");
      }
    },
    convertOnClose: (document) => {
      attempt(document.uri.toString(), "closed");
    },
    dispose: () => {
      for (const key of [...pending.keys()]) {
        // 1件の失敗(ファイルが外部で消された場合など)で残りを止めない
        try {
          attempt(key, "dispose");
        } catch {
          // 終了処理中なので、これ以上できることはない
        }
      }
    },
  };
}

/**
 * 保存直後のドキュメントを変換する
 *
 * @returns `true`: ファイルを書き換えた
 */
export function replaceSpecificCharacters(
  document: vscode.TextDocument,
): boolean {
  return convertFile(document, true);
}

/**
 * ディスク上のファイルを読み、変換対象のバイト列があれば書き換える
 *
 * @param document 変換するドキュメント
 * @param textIsSaved ドキュメントのテキストが保存内容と同じか。`true`なら
 *   テキストに対象文字が無い時点でディスクを読まずに終える
 * @returns `true`: ファイルを書き換えた
 */
function convertFile(
  document: vscode.TextDocument,
  textIsSaved: boolean,
): boolean {
  // 予約後に設定やエンコーディングが変わっていることがあるので、毎回確認する
  if (!isConvertEnabled() || !canBeEUCJP(document)) {
    return false;
  }

  // 0x8F 0xA2 0xB7 / 0x8F 0xA2 0xF1を生むのはU+FF5E / U+2116だけなので、
  // テキストにそれらが無ければディスクにも変換対象は無い
  if (textIsSaved && !containsConvertTargetCharacters(document)) {
    return false;
  }

  const fileName = document.fileName;
  const content = fs.readFileSync(fileName);
  const converted = replaceSpecificCharactersInBuffer(content);

  // convertBytesは変換対象が無いときだけ同じBufferを返すので、参照の比較で足りる
  if (converted === content) {
    return false;
  }

  // 1.100.0未満ではここでファイル全体を走査するため、置換の後に置いて
  // 変換対象の無いファイルでは走査しないようにしている。
  // 置換はcontentを書き換えないので、この順序でも安全性は変わらない
  if (!isEUCJPConfirmed(document, content)) {
    return false;
  }

  fs.writeFileSync(fileName, converted, { flag: "w" });

  return true;
}

/**
 * 書き換えたファイルの状態をエディタに同期する
 *
 * revertで再読込してetagを合わせる。変換後のバイト列はデコードすると同じテキストに
 * なるので、エディタの内容・カーソル位置・undo履歴は変わらない
 *
 * 既知の残余リスク: revertコマンドは引数を見ず、実行時点のアクティブエディタに作用する。
 * 下の確認から実行までの間にタブを切り替えられると、別のドキュメントがrevertされうる。
 * ドキュメントを指定してrevertする公開APIは無い
 */
async function syncEditorWithConvertedFile(document: vscode.TextDocument) {
  // 未保存の編集を失わないよう、アクティブかつ未編集のときだけ実行する
  const activeDocument = vscode.window.activeTextEditor?.document;
  if (activeDocument !== document || document.isDirty) {
    return;
  }

  try {
    await vscode.commands.executeCommand("workbench.action.files.revert");
  } catch {
    // 失敗しても、これ以上できることはない
  }
}

/**
 * ドキュメントに、設定で有効な変換対象の文字が含まれるかを返す
 *
 * すべて無効ならgetText()(全文のコピー)を呼ばずに終える
 */
export function containsConvertTargetCharacters(
  document: vscode.TextDocument,
): boolean {
  const targets = getEnabledTargets();

  if (targets.length === 0) {
    return false;
  }

  return containsTargetCharacters(document.getText(), targets);
}

/**
 * バッファ中の、設定で有効な変換対象のバイト列を置き換える
 *
 * @returns 変換後のバッファ。変換対象が無ければ引数そのもの
 */
export function replaceSpecificCharactersInBuffer(buf: Buffer): Buffer {
  return convertBytes(buf, getEnabledTargets());
}
