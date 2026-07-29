# Wave Dash Unify

[![Test & Publish](https://github.com/yutotnh/wave-dash-unify/actions/workflows/test-and-publish.yml/badge.svg?branch=main)](https://github.com/yutotnh/wave-dash-unify/actions/workflows/test-and-publish.yml)
[![Lint](https://github.com/yutotnh/wave-dash-unify/actions/workflows/lint.yml/badge.svg?branch=main)](https://github.com/yutotnh/wave-dash-unify/actions/workflows/lint.yml)
[![Format](https://github.com/yutotnh/wave-dash-unify/actions/workflows/format.yml/badge.svg?branch=main)](https://github.com/yutotnh/wave-dash-unify/actions/workflows/format.yml)

[![Dev Containers](https://github.com/yutotnh/wave-dash-unify/actions/workflows/devcontainer.yml/badge.svg?branch=main)](https://github.com/yutotnh/wave-dash-unify/actions/workflows/devcontainer.yml)
[![CodeQL](https://github.com/yutotnh/wave-dash-unify/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/yutotnh/wave-dash-unify/actions/workflows/codeql.yml)

EUC-JP のファイルを保存した時に、以下の文字の置き換えを行います。

| 置き換え対象文字                | 置き換え後                 |
| ------------------------------- | -------------------------- |
| 全角チルダ (～: 0x8F 0xA2 0xB7) | 波ダッシュ (〜: 0xA1 0xC1) |
| 全角NO (№: 0x8F 0xA2 0xF1)      | 全角NO (№: 0xAD 0xE2)      |

## Features

VS Code ではファイルの文字コードに EUC-JP を指定した状態で`～`という文字を保存すると、一般的に使われる波ダッシュ(0xA1 0xC1)ではなく全角チルダ(0x8F 0xA2 0xB7)で保存されてしまい、他のツールでファイルを閲覧した際に文字化けする問題があります。この拡張機能をインストールすると、保存時にこれらの文字を自動で置き換え、文字化けを回避します。

保存タイミングの制御など内部の処理詳細は [doc/design.md](doc/design.md) を参照してください。

## Installation

[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=yutotnh.wave-dash-unify) からインストールできます。

VS Code の拡張機能ビューで `wave-dash-unify` を検索してインストールすることもできます。

## Requirements

VS Code 1.66.0 以降で動作します。EUC-JP の判定ロジックの詳細は [doc/design.md](doc/design.md) を参照してください。

## Extension Settings

- `waveDashUnify.enableConvert`: 文字の変換をします
- `waveDashUnify.fullwidthTildeToWaveDash`: 全角チルダ (0x8F 0xA2 0xB7) を波ダッシュ (0xA1 0xC1) に変換します
- `waveDashUnify.numeroSignToNumeroSign`: 全角NO (0x8F 0xA2 0xF1) を全角NO (0xAD 0xE2) に変換します
- `waveDashUnify.statusBarFormat`: ステータス バーのフォーマット

## Release Notes

[CHANGELOG](CHANGELOG.md) を参照してください。
