# Change Log

All notable changes to the "wave-dash-unify" extension will be documented in this file.

The format is based on [Keep a Changelog](http://keepachangelog.com/).

This file is maintained by hand, not generated from the pull request list. Only changes that
affect users of the extension (features, fixes, behavior changes) are recorded here. Dependency
updates (dependabot) and internal-only changes (CI, tooling, refactoring with no behavior change)
are intentionally omitted; see the [full commit history](https://github.com/yutotnh/wave-dash-unify/commits/main)
or each release's GitHub Releases page for those.

## [Unreleased]

## [0.4.1] - 2025-05-10

### Changed

- EUC-JPの変換処理のパフォーマンスを改善しました。([#521](https://github.com/yutotnh/wave-dash-unify/pull/521))

## [0.4.0] - 2025-05-10

### Changed

- 変換処理の実行時間を短縮しました。([#517](https://github.com/yutotnh/wave-dash-unify/pull/517))

## [0.3.3] - 2025-05-12

### Changed

- EUC-JPの変換処理のパフォーマンスを改善しました。([#521](https://github.com/yutotnh/wave-dash-unify/pull/521))

## [0.3.2] - 2025-05-10

### Changed

- 対応するVS Codeの最小バージョンを1.66.0以降に変更しました。([#509](https://github.com/yutotnh/wave-dash-unify/pull/509))

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

### Changed

- 設定の説明文の表記を「full-width」から「fullwidth」に統一しました。([#181](https://github.com/yutotnh/wave-dash-unify/pull/181))

## [0.0.3] - 2023-07-23

### Fixed

- GitHub Releaseに.vsixファイルが添付されない問題を修正しました。([#35](https://github.com/yutotnh/wave-dash-unify/pull/35))

## [0.0.2] - 2023-05-28

### Fixed

- 全角チルダの変換対象バイト列の誤りを修正しました。([#17](https://github.com/yutotnh/wave-dash-unify/pull/17))

## [0.0.1] - 2023-05-28

- Initial release
