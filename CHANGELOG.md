# Change Log

All notable changes to the "wave-dash-unify" extension will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/).

This file is maintained by hand, not generated from the pull request list. Only changes that
affect users of the extension (features, fixes, behavior changes) are recorded here. Dependency
updates (dependabot) and internal-only changes (CI, tooling, refactoring with no behavior change)
are intentionally omitted; see the [full commit history](https://github.com/yutotnh/wave-dash-unify/commits/main)
or each release's GitHub Releases page for those.

## [Unreleased]

### Added

- Open VSX Registryでの配布に対応しました。VSCodiumなど、Open VSXを利用するエディターにもインストールできるようになりました。([#642](https://github.com/yutotnh/wave-dash-unify/pull/642))

### Changed

- 変換処理を高速化し、大きなファイルを保存する際の遅延を大幅に軽減しました。([#627](https://github.com/yutotnh/wave-dash-unify/pull/627), [#633](https://github.com/yutotnh/wave-dash-unify/pull/633))
- ステータスバーの文字数カウントの更新をデバウンスし、大きなファイルの編集中の負荷を軽減しました。([#632](https://github.com/yutotnh/wave-dash-unify/pull/632))
- 対応するVS Codeの最小バージョンを1.100.0から1.66.0に引き下げ、古いVS Codeでも最新版を利用できるようにしました。0.4.0([#517](https://github.com/yutotnh/wave-dash-unify/pull/517))で必要になっていた1.100.0以降という制限を解消するもので、1.100.0以降では引き続きVS CodeのAPIでEUC-JPを判定します。([#661](https://github.com/yutotnh/wave-dash-unify/pull/661))

### Fixed

- ファイルを連続して素早く保存したときに、拡張機能による変換とVS Codeの保存が競合し、変換結果が反映されないことがある問題を修正しました。([#628](https://github.com/yutotnh/wave-dash-unify/pull/628))

## [0.4.1] - 2025-05-10

### Changed

- EUC-JPの変換処理のパフォーマンスを改善しました。([#521](https://github.com/yutotnh/wave-dash-unify/pull/521))

## [0.4.0] - 2025-05-10

### Changed

- 対応するVS Codeの最小バージョンを1.100.0以降に変更しました。1.100.0より前のVS Codeでは0.3系をご利用ください。([#517](https://github.com/yutotnh/wave-dash-unify/pull/517))
- EUC-JPの判定をVS Codeの標準APIに変更し、変換処理の実行時間を短縮しました。([#517](https://github.com/yutotnh/wave-dash-unify/pull/517))

## [0.3.3] - 2025-05-12

VS Code 1.100.0未満の環境向けのリリースです(0.4.1と同じ変更を含みます)。

### Changed

- EUC-JPの変換処理のパフォーマンスを改善しました。([#521](https://github.com/yutotnh/wave-dash-unify/pull/521))

## [0.3.2] - 2025-05-10

### Changed

- 対応するVS Codeの最小バージョンを1.78.0から1.66.0に引き下げ、より古いVS Codeでも利用できるようにしました。([#511](https://github.com/yutotnh/wave-dash-unify/pull/511))

## [0.3.1] - 2025-01-19

### Added

- 日本語のローカライズを追加し、設定の説明文を更新しました。([#442](https://github.com/yutotnh/wave-dash-unify/pull/442))
- コマンドパレットのコマンドにカテゴリ「Wave Dash Unify」を追加しました。([#441](https://github.com/yutotnh/wave-dash-unify/pull/441))

## [0.3.0] - 2024-12-30

### Added

- ステータスバーの表示形式を設定でカスタマイズできるようにしました。([#427](https://github.com/yutotnh/wave-dash-unify/pull/427))
- ステータスバーの項目をクリックして変換の有効/無効を切り替えられるようにしました。([#429](https://github.com/yutotnh/wave-dash-unify/pull/429))

### Fixed

- リソースの解放漏れを修正しました。([#428](https://github.com/yutotnh/wave-dash-unify/pull/428))

## [0.2.0] - 2024-12-30

### Added

- 全角NO(№)の文字化け対策に対応しました。([#423](https://github.com/yutotnh/wave-dash-unify/pull/423))

## [0.1.1] - 2024-03-26

### Changed

- パッケージサイズを削減するため、配布物に不要なファイルを除外しました。([#224](https://github.com/yutotnh/wave-dash-unify/pull/224), [#253](https://github.com/yutotnh/wave-dash-unify/pull/253))

## [0.1.0] - 2023-11-24

### Added

- ステータスバーに全角チルダと波ダッシュの個数を表示するようにしました。([#178](https://github.com/yutotnh/wave-dash-unify/pull/178))
- 変換の有効/無効を切り替えるコマンドを追加しました。([#180](https://github.com/yutotnh/wave-dash-unify/pull/180))

## [0.0.3] - 2023-07-23

### Fixed

- GitHub Releaseに.vsixファイルが添付されない問題を修正しました。([#35](https://github.com/yutotnh/wave-dash-unify/pull/35))

## [0.0.2] - 2023-05-28

### Fixed

- 全角チルダの変換対象バイト列の誤りを修正しました。([#17](https://github.com/yutotnh/wave-dash-unify/pull/17))

## [0.0.1] - 2023-05-28

- Initial release
