/**
 * デバウンスされたスケジューラ
 */
export interface Debouncer {
  /**
   * 実行をスケジュールする
   *
   * 既に未実行のスケジュールがあれば破棄して積み直す。短時間に連続して
   * 呼び出しても、最後のscheduleからdelayMsだけ経過した時点でcallbackが
   * 1回だけ実行される(trailing edge)
   */
  schedule: () => void;

  /**
   * スケジュール済みの未実行の呼び出しを破棄する
   *
   * 既に実行済み、または何もスケジュールされていない場合は何もしない
   */
  cancel: () => void;
}

/**
 * 関数の実行をデバウンスするDebouncerを作る
 *
 * VS Codeに依存しない独立したユニットなので、このモジュール単体で
 * 単体テストできる
 *
 * @param callback デバウンスして実行する関数
 * @param delayMs 最後のscheduleからcallbackを実行するまでの遅延時間(ms)
 * @returns 作成したDebouncer
 */
export function createDebouncer(
  callback: () => void,
  delayMs: number,
): Debouncer {
  let timer: ReturnType<typeof setTimeout> | undefined;

  function cancel() {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  }

  function schedule() {
    cancel();

    timer = setTimeout(() => {
      timer = undefined;
      callback();
    }, delayMs);
  }

  return { schedule, cancel };
}
