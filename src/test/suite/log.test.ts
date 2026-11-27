import * as assert from "assert";
import { formatError, logError } from "../../log";

suite("log", () => {
  test("Errorはスタックトレースにする", () => {
    const error = new Error("boom");

    assert.strictEqual(formatError(error), error.stack);
  });

  test("スタックトレースが無いErrorは名前とメッセージにする", () => {
    const error = new TypeError("boom");
    delete error.stack;

    assert.strictEqual(formatError(error), "TypeError: boom");
  });

  test("Error以外は文字列にする", () => {
    assert.strictEqual(formatError("boom"), "boom");
    assert.strictEqual(formatError(undefined), "undefined");
  });

  test("setupLogの前に呼んでも例外を投げない", () => {
    assert.doesNotThrow(() => {
      logError("message", new Error("boom"));
    });
  });
});
