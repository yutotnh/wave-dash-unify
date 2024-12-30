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
| 全角NO     (№: 0x8F 0xA2 0xF1)  | 全角NO     (№: 0xAD 0xE2)  |

## Features

VS Code ではファイルの文字コードに EUC-JP を指定した状態で`～`という文字を保存した際に一般的に使われる波ダッシュ(0xA1 0xC1)ではなく、全角チルダ(0x8F 0xA2 0xB7)で保存されます

そのため、VS Code で`～`を含まれる EUC-JP のファイルを編集した際に他のツールでファイルを閲覧すると文字化けするといった問題が発生します

この拡張機能をインストールすると、EUC-JP のファイルを保存した時に全角チルダ(0x8F 0xA2 0xB7)を波ダッシュ(0xA1 0xC1)に変更し、前述の文字化け問題を回避します

その他置き換え対象文字についても、同様の処理を行います

おおまかな処理は以下の通りです

```mermaid
sequenceDiagram
    autonumber

    actor User
    participant vscode as VS Code
    participant extension as Wave Dash Unify
    participant file as ファイル(EUC-JP)

    User ->> vscode: ファイル保存処理を依頼
    vscode ->> file: EUC-JPでファイルを保存
    vscode ->> extension: ファイルを保存したことを通知
    extension ->> file: ファイルの中身を要求する
    file ->> extension: ファイルの中身を返す
    extension ->> extension: ファイルの中の置き換え対象文字を置き換える
    extension ->> file: 変換した中身を保存する
```

## Extension Settings

- `waveDashUnify.enableConvert`: Enable convert to target characters
- `waveDashUnify.fullwidthTildeToWaveDash`: Convert fullwidth tilde to wave dash
- `waveDashUnify.numeroSignToNumeroSign`: Convert numero sign (0x8F 0xA2 0xF1) to numero sign (0xAD 0xE2)

## Known Issues

### [Ctrl+S を長押しすると、ファイルの上書きに失敗する](https://github.com/yutotnh/wave-dash-unify/issues/13)

`Ctrl+S`を長押しするなどして、短時間に連続して`～`の含まれる EUC-JP のファイルを保存した場合に、下記画像のようなエラーが発生します

![overwrite error](./doc/overwrite-error.png)

## Release Notes

See changelog
