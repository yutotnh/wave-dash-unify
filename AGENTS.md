# AGENTS.md

wave-dash-unifyは単一パッケージのTypeScript製VS Code拡張機能。本体コードは`src/`、テストは`src/test/suite/`。コマンドは`package.json`の`scripts`を参照する。変更後は最低限`npm run lint` / `format-check` / `spellcheck` / `test`を通す。

既知の制約: サンドボックス環境ではネットワーク制限で`update.code.visualstudio.com`に到達できず、`npm test`(Electron版)がローカル実行できないことがある(#627, #654)。その場合は`tsc` / `eslint` / `webpack` / `prettier` / `cspell`のみローカルで検証し、テスト結果はCI(3 OSマトリクス)で確認する旨をPR本文に書く。

## CHANGELOG.md

- ユーザー向け変更(feat/fix/perf/挙動変更)なら`CHANGELOG.md`の`[Unreleased]`に追記する(運用方針は`CHANGELOG.md`冒頭を参照。依存関係更新・内部限定の変更は対象外)
- 追記対象は`git log <直近タグ>..main`から拾う
- PR番号のないコミットはGitHub上でPRを検索して引用する
- 追記後は`npm run format-check`と`npm run spellcheck`を通す

## PRのラベル

内容に応じたラベルを付ける(過去に付け忘れが多かった)。

- feat → `enhancement`
- fix → `bug`
- perf → `enhancement`
- docs → `documentation`
- 上記以外(refactor/chore/testなど)は無理に付けない

## Node.jsバージョン

`.nvmrc`が唯一の情報源。VS Code拡張のExtension HostはVS Code同梱のNode.js上で動くため、`microsoft/vscode`自身の`.nvmrc`に合わせる。

- CIは`actions/setup-node`の`node-version-file: ./.nvmrc`で自動追従する(ワークフロー変更は不要)
- `.devcontainer/`もビルド時に`.nvmrc`を読んでnvmでインストールする(Dockerfileへの直書きはしない)
- 上げる場合は`.nvmrc`を書き換え、`@types/node`のメジャーバージョンも追従させ、`.github/dependabot.yml`の無視ルールも更新する
- 注意: `@types/node`(型定義)が追従する`.nvmrc`と、Extension Host内で実際に動くコード(`src/extension.ts`/`debounce.ts`/`eucjp.ts`/`src/test/suite/**`)の実行時Node.jsバージョン(`engines.vscode`が同梱するNode.js、現状v16.13.0)は別物。両者の乖離により`tsc`がNode 18+専用APIの誤用を見逃さないよう、`eslint.config.js`の`eslint-plugin-n`(`n/no-unsupported-features/*`)がExtension Host側コードを実行時floorでガードしている(詳細は`.github/dependabot.yml`の`@types/node`コメント参照)

## パフォーマンスに関する変更

保存処理・ホットパス(キーストローク毎の処理など)に影響する変更は、変更前後の実行時間を計測しPR本文に含める。

- 再現可能なベンチマークスクリプトを貼る(例: [#627](https://github.com/yutotnh/wave-dash-unify/pull/627), [#632](https://github.com/yutotnh/wave-dash-unify/pull/632), [#633](https://github.com/yutotnh/wave-dash-unify/pull/633))
- 複数シナリオ(ファイルサイズ、変換対象の有無)で比較する
- 結果は表形式(変更前/変更後/倍率)でまとめる

## コミット規約

Conventional Commits(`feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `chore:` / `perf:` / `build(deps):` / `build(deps-dev):`)。PRはsquash mergeされ、件名末尾に`(#PR番号)`が付く。

## 新しいファイル/ディレクトリを追加するとき

`.vscodeignore`はVSIX(配布物)からの除外リストで、既存パターン(`.github/**`等)に含まれない新規パスはどこに追加してもデフォルトで同梱される。エンドユーザーに不要なもの(AIエージェント専用ファイルなど)は`.vscodeignore`への追加要否を確認する(`.claude/**`、`AGENTS.md`/`CLAUDE.md`と同じ理由)。`npx vsce ls`で実際の同梱ファイルを確認できる。
