import * as assert from "assert";
import { createDebouncer } from "../../debounce";

/**
 * createDebouncerのテスト
 *
 * VS Codeに依存しないユニットのため、実タイマー(setTimeout)を使い
 * VS Code拡張ホストの外でも成立する単体テストとして書く。
 * フレーキーにならないよう、遅延は小さい値にしつつ、判定に使う待ち時間には
 * 十分なマージンを取っている
 */
suite("Debouncer", () => {
  // 判定に使う待ち時間のマージンを十分に取れるよう、実装で使う200msより
  // 短く、かつタイマーの誤差に埋もれない値にする
  const DELAY_MS = 100;

  test("連続してscheduleしてもコールバックは1回だけ実行される", async () => {
    let callCount = 0;
    const debouncer = createDebouncer(() => {
      callCount++;
    }, DELAY_MS);

    debouncer.schedule();
    debouncer.schedule();
    debouncer.schedule();

    // 最後のscheduleからDELAY_MSの3倍待てば、実行されていれば確実に済んでいる
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS * 3));

    assert.strictEqual(callCount, 1, "コールバックが1回だけ実行されなかった");
  });

  test("最後のscheduleからDELAY_MS後に実行される(trailing edge)", async () => {
    let callCount = 0;
    const debouncer = createDebouncer(() => {
      callCount++;
    }, DELAY_MS);

    // GAP_MSはDELAY_MSより短いが、初回scheduleを起点にする(leading edge化する)
    // 実装が壊れていた場合は起点+DELAY_MSの時点で既に実行されてしまう時間を確保する
    const GAP_MS = DELAY_MS * 0.6;

    debouncer.schedule();
    await new Promise((resolve) => setTimeout(resolve, GAP_MS));
    debouncer.schedule();

    // 「初回scheduleを起点にした場合の実行時刻」は過ぎているが、
    // 「最後のscheduleを起点にした場合の実行時刻」にはまだ届いていない時点で確認する。
    // ここでcallCountが1になっていたら、初回scheduleを起点に実行された(leading edge化
    // されている)ことになる
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS * 0.7));
    assert.strictEqual(
      callCount,
      0,
      "最後のscheduleではなく、それより前のscheduleを起点に実行された",
    );

    // 最後のscheduleを起点にした実行時刻を十分過ぎるまで待つ
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS * 3));
    assert.strictEqual(
      callCount,
      1,
      "最後のscheduleからDELAY_MS経過しても実行されなかった",
    );
  });

  test("cancelするとコールバックは実行されない", async () => {
    let callCount = 0;
    const debouncer = createDebouncer(() => {
      callCount++;
    }, DELAY_MS);

    debouncer.schedule();
    debouncer.cancel();

    await new Promise((resolve) => setTimeout(resolve, DELAY_MS * 3));

    assert.strictEqual(callCount, 0, "cancelしたのにコールバックが実行された");
  });

  test("一度実行された後、再度scheduleすると再び実行される", async () => {
    let callCount = 0;
    const debouncer = createDebouncer(() => {
      callCount++;
    }, DELAY_MS);

    debouncer.schedule();
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS * 3));
    assert.strictEqual(callCount, 1, "1回目のscheduleが実行されなかった");

    debouncer.schedule();
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS * 3));
    assert.strictEqual(callCount, 2, "2回目のscheduleが実行されなかった");
  });
});
