# chat-app

ローカル Ollama を使う Electron チャットアプリです。

## 起動

```bash
npm install
npm run setup-vendor
npm start
```

## Web検索（Tavily）

### 使い方

1. 入力欄の横にある地球儀チェックをオンにする
2. メッセージを送信する
3. ステータスバーに以下の進捗がリアルタイム表示される
	 - ウェブ検索中…
	 - 検索結果を要約中…
	 - 回答を生成中…

地球儀チェックがオフの場合は、通常のローカル推論のみ実行します。

### API Key 設定（重要）

Tavily API Key はコードに直書きしません。Git にコミットしない運用を前提としています。

GUI から設定する場合:

1. 左下の歯車ボタンから設定画面を開く
2. Tavily API Key セクションに Key を貼り付ける
3. 保存ボタンを押す

保存すると `userData` 配下の `tavily-config.json` が作成または上書きされます。

優先順位:

1. 環境変数 `TAVILY_API_KEY`
2. Electron の `userData` 配下 `tavily-config.json` の `apiKey`

`tavily-config.json` 例:

```json
{
	"apiKey": "tvly-xxxxxxxxxxxxxxxx"
}
```

macOS の `userData` は通常次のような場所です。

```text
~/Library/Application Support/chat-app/
```

## セキュリティ運用

- API Key は Main プロセスのみで参照し、Renderer には渡しません
- `.env.local` と `tavily-config.json` は `.gitignore` に登録済みです
- コミット前に `git status --short` で秘密情報ファイルが含まれていないことを確認してください
