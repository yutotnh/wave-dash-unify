import * as assert from "assert";
import * as vscode from "vscode";

/**
 * VS Code 1.100.0以降で追加されたAPIとの互換レイヤー(テストコード専用)
 *
 * package.jsonのengines.vscodeは1.66.0に固定されているため、@types/vscodeにも
 * `TextDocument.encoding`・`workspace.encode`・`workspace.decode`・
 * `workspace.openTextDocument({content, encoding})`の型定義は存在しない。
 * しかしテストを実行するVS Code自体は1.100.0以降のこともあり、その場合は
 * これらのAPIをテストから直接使いたい。
 *
 * 「型には無いが実行時には有るかもしれないAPI」を呼ぶためのキャストを
 * テストファイルのあちこちに散らすと、型の辻褄合わせなのか本質的なロジック
 * なのかが読み取りにくくなる。そのためキャストと存在チェックをこのファイルに
 * 集約し、他のテストファイルはここが公開する関数だけを使う
 * (src/eucjp.tsが本体コード側で同じ役割を果たしているのと対になる構成)
 *
 * 分岐は常にAPIの存在チェックで行い、VS Codeのバージョン文字列は見ない
 */

/** `TextDocument.encoding`を持つTextDocument(1.100.0以降) */
type DocumentWithEncoding = vscode.TextDocument & {
  readonly encoding?: string;
};

/** `{content, encoding}`でドキュメントを開けるworkspace(1.100.0以降) */
type WorkspaceWithEncodingOpen = typeof vscode.workspace & {
  openTextDocument(options: {
    content: string;
    encoding: string;
  }): Thenable<vscode.TextDocument>;
};

/** `encode`/`decode`を持つworkspace(1.100.0以降) */
type WorkspaceWithCodec = typeof vscode.workspace & {
  encode(content: string, options: { encoding: string }): Thenable<Uint8Array>;
  decode(content: Uint8Array, options: { encoding: string }): Thenable<string>;
};

/**
 * 実行中のVS Codeが1.100.0以降のエンコーディングAPI
 * (`workspace.encode`/`workspace.decode`)を持つかを判定する
 *
 * バージョン文字列の比較ではなく、実際にAPIが生えているかで判定する
 * (src/eucjp.tsの`isEUCJPDocument`と同じ方針)。これを使うテストは、
 * 判定がfalseになる環境(1.100.0未満)では`this.skip()`でスキップすること
 *
 * @returns `true`: エンコーディングAPIが使える, `false`: 使えない(1.100.0未満)
 */
export function supportsEncodingApi(): boolean {
  return typeof (vscode.workspace as WorkspaceWithCodec).encode === "function";
}

/**
 * `TextDocument.encoding`をキャスト経由で読む
 *
 * 1.100.0未満の環境ではプロパティ自体が存在しないため`undefined`を返す
 *
 * @param document 対象のドキュメント
 * @returns VS Codeが認識しているエンコーディングID(例: "eucjp")。取得できなければ`undefined`
 */
export function getDocumentEncoding(
  document: vscode.TextDocument,
): string | undefined {
  return (document as DocumentWithEncoding).encoding;
}

/**
 * エンコーディングを指定してドキュメントを開く
 *
 * 1.100.0以降でのみ呼び出せる(呼び出し側で`supportsEncodingApi()`を確認してから使うこと)。
 * `vscode.workspace.openTextDocument`の型定義(@types/vscode 1.66.0)には
 * `encoding`を受け取るオーバーロードが無いため、ここでキャストして吸収する
 *
 * @param content ドキュメントの内容
 * @param encoding 開く際に使うエンコーディングID(例: "eucjp", "utf8")
 * @returns 開いたドキュメント
 */
export function openTextDocumentWithEncoding(
  content: string,
  encoding: string,
): Thenable<vscode.TextDocument> {
  return (vscode.workspace as WorkspaceWithEncodingOpen).openTextDocument({
    content,
    encoding,
  });
}

/**
 * 文字列を指定エンコーディングのバイト列にエンコードする
 *
 * 1.100.0以降でのみ呼び出せる(呼び出し側で`supportsEncodingApi()`を確認してから使うこと)
 *
 * @param text エンコードする文字列
 * @param encoding エンコーディングID(例: "eucjp")
 * @returns エンコードされたバイト列
 */
export function encodeText(
  text: string,
  encoding: string,
): Thenable<Uint8Array> {
  return (vscode.workspace as WorkspaceWithCodec).encode(text, { encoding });
}

/**
 * バイト列を指定エンコーディングでデコードする
 *
 * 1.100.0以降でのみ呼び出せる(呼び出し側で`supportsEncodingApi()`を確認してから使うこと)
 *
 * @param bytes デコードするバイト列
 * @param encoding エンコーディングID(例: "eucjp")
 * @returns デコードされた文字列
 */
export function decodeBytes(
  bytes: Uint8Array,
  encoding: string,
): Thenable<string> {
  return (vscode.workspace as WorkspaceWithCodec).decode(bytes, { encoding });
}

/**
 * ドキュメントがEUC-JPとしてデコードされていることをバージョン非依存に確認する
 *
 * テストの前提条件(「保存対象のファイルがEUC-JPと判定されていること」)を
 * 確認するための共通アサーション。まず`document.getText()`が`expectedText`と
 * 一致することを確認する(これはどのVS Codeでも成立する、テキストベースの確認)。
 * 加えて、1.100.0以降の環境では`document.encoding`が"eucjp"であることも
 * 確認し、「たまたま別のエンコーディングとして開かれたのに、偶然同じ文字列に
 * デコードされた」ような取り違えも検出できるようにする。1.100.0未満では
 * `document.encoding`自体が存在しないため、この追加確認はスキップする
 *
 * @param document 確認対象のドキュメント
 * @param expectedText 期待するテキスト(EUC-JPとしてデコードした結果)
 * @param message アサーション失敗時のメッセージ(省略時は既定のメッセージ)
 */
export function assertDecodedAsEucjp(
  document: vscode.TextDocument,
  expectedText: string,
  message?: string,
): void {
  assert.strictEqual(
    document.getText(),
    expectedText,
    message ??
      "前提条件エラー: ドキュメントの内容がEUC-JPとしてデコードした期待値と一致しなかった",
  );

  if (supportsEncodingApi()) {
    assert.strictEqual(
      getDocumentEncoding(document),
      "eucjp",
      message ?? "前提条件エラー: ファイルがEUC-JPと判定されなかった",
    );
  }
}
