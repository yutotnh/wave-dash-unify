# AGENTS.md

このファイルは、AIエージェント(Claude Codeなど)がこのリポジトリで作業する際に、毎回ゼロから調べ直さずに済むよう、コードを読むだけでは分からない運用知識をまとめたものです。コマンドやディレクトリ構成そのものは `package.json` / リポジトリ構造から分かるため、ここには載せていません。

`wave-dash-unify` は単一パッケージのTypeScript製VS Code拡張機能です。本体コードは `src/`、テストは `src/test/suite/` にあります。開発用コマンドは `package.json` の `scripts` を参照してください。変更後は最低限 `npm run lint` / `npm run format-check` / `npm run spellcheck` / `npm test` を通してください。

**既知の制約**: サンドボックス環境ではネットワーク制限により `update.code.visualstudio.com` に到達できず、`npm test`(Electron版)がローカル実行できないことがあります(#627, #654 で繰り返し発生)。その場合は `tsc` / `eslint` / `webpack` / `prettier` などローカルで実行可能な検証のみ済ませ、実際のテスト結果はCI(3 OSマトリクス)を確認する旨をPR本文に記載してください。

## CHANGELOG.md

- **PR/コミットを作成する前に必ず**、その変更がユーザー向け(feat / fix / perf / 挙動変更)かどうかを確認してください。該当する場合は `CHANGELOG.md` の `[Unreleased]` に追記します(運用方針は `CHANGELOG.md` 冒頭を参照。依存関係更新や内部限定の変更(CI/tooling/挙動に影響しないリファクタリング)は載せません)
- 追記対象を洗い出す際は `git log <直近タグ>..main` から拾います
- rebaseマージで件名にPR番号が付いていないコミットは、GitHub上でPRを検索して正しい番号を引用します
- 追記後は `npm run format-check` と `npm run spellcheck` を通します

## PRのラベル

PRを作成する際は、必ず内容に応じたラベルを付けてください(過去にラベル無しで作成されることが多かったため)。

- 新機能(feat) → `enhancement`
- バグ修正(fix) → `bug`
- パフォーマンス改善(perf) → `enhancement`
- ドキュメント(docs) → `documentation`
- 上記に当てはまらない場合(refactor/chore/testなど)は無理に付けなくてよい

## Node.jsバージョン

`.nvmrc` が唯一の情報源です。VS Code拡張機能のExtension HostはVS Code同梱のNode.js上で動くため、`microsoft/vscode` 自身の `.nvmrc` に値を合わせています。

- CIは `actions/setup-node` の `node-version-file: ./.nvmrc` 経由で自動追従します(ワークフローYAMLの変更は不要)
- `.devcontainer/` もビルド時に `.nvmrc` を読んでnvmでインストールするため、Dockerfileへの直書きはしません
- Node.jsバージョンを上げる場合は `.nvmrc` を書き換えるだけでよいですが、`@types/node` のメジャーバージョンも実行時Node.jsに合わせて追従させ、`.github/dependabot.yml` の `@types/node` 無視ルール(メジャー更新のみ無視)も併せて更新してください

## パフォーマンスに関する変更

保存処理やホットパス(キーストローク毎に走る処理など)に影響する変更を行う場合は、変更前後の実行時間を計測し、PR本文に含めてください。

- 再現可能なベンチマークスクリプトをPR本文に貼る(過去の例: [#627](https://github.com/yutotnh/wave-dash-unify/pull/627), [#632](https://github.com/yutotnh/wave-dash-unify/pull/632), [#633](https://github.com/yutotnh/wave-dash-unify/pull/633))
- 代表的なファイルサイズ(例: 1MB, 10MB)や、変換対象の有無など複数シナリオで比較する
- 計測結果は表形式(変更前 / 変更後 / 倍率)でまとめる

## コミット規約

コミット件名はConventional Commits形式(`feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `chore:` / `perf:` / `build(deps):` / `build(deps-dev):`)の接頭辞を使います。PRはsquash mergeされ、件名末尾に `(#PR番号)` が自動的に付与されます。
