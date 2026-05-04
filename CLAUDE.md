# CLAUDE.md

このファイルは、リポジトリで作業する Claude Code (claude.ai/code) へのガイダンスを提供します。

## コマンド

```bash
npm start        # Electron アプリを起動（事前に Ollama をローカルで起動しておく必要あり）
```

ビルドステップ、バンドラー、トランスパイラー、テストスイートはありません。JavaScript は Electron によって直接読み込まれます。

**前提条件:** アプリ起動前に Ollama が `localhost:11434` で動作している必要があります。`ollama pull <モデル名>` でモデルをインストールしてください（例: `ollama pull llama3`）。

## アーキテクチャ

ローカルで動作する Ollama LLM 向けのチャット UI を提供する Electron デスクトップアプリです。標準的な Electron の3プロセスモデルに従っています。

```
レンダラー（ブラウザコンテキスト）
  └─ window.ollama API（preload.js の contextBridge 経由で公開）
       └─ IPC（ipcRenderer.invoke / ipcRenderer.send）
            └─ メインプロセス（src/main.js）
                 └─ localhost:11434 の Ollama への HTTP 通信
```

### プロセスの役割分担

- **`src/main.js`** — メインプロセス。すべてのネットワーク I/O を担当（Node.js の `http` モジュール）。2つの IPC ハンドラーを実装：
  - `ollama:get-models`（invoke）— `GET /api/tags` を呼び出し、モデル名のリストを返す。
  - `ollama:chat`（on）— `/api/chat` へのストリーミング POST を開始し、改行区切りの JSON チャンクを `ollama:chat:chunk` イベントとしてレンダラーへ転送。失敗時は `ollama:chat:error` を送信。中断関数を返すが、IPC 経由では公開していないため現状レンダラーからストリーミングをキャンセルすることはできない。

- **`src/preload.js`** — Node.js アクセス権を持ちつつレンダラーのコンテキストで動作する。`contextBridge.exposeInMainWorld('ollama', ...)` を使って、型付きの最小限の API を公開する。レンダラーは Node.js やネットワークへの直接アクセスを持たず、すべての Ollama 呼び出しはこのブリッジを経由する。

- **`src/renderer/`** — フレームワーク不使用の素の HTML/CSS/JS。`renderer.js` が UI の状態（`messages[]`、`isGenerating`、`requestCounter`）を管理し、チャットバブルをレンダリングし、リクエストごとに `requestId` パターンを使って IPC チャンクイベントの購読・解除を行い、リクエスト間の混線を防ぐ。

### ストリーミングの IPC イベントフロー

1. レンダラーが `window.ollama.chat(requestId, model, messages)` を呼び出す（fire-and-forget の `ipcRenderer.send`）。
2. メインプロセスが Ollama へのストリーミング HTTP 接続を開き、改行区切りの JSON をパース。
3. 各トークンが `ollama:chat:chunk` → `{ requestId, content, done: false }` としてレンダラーへ転送される。
4. 最終チャンクで `{ requestId, content: '', done: true }` が送信される。
5. レンダラーは `requestId` でイベントをフィルタリングし、`finish()` でリスナーを解除する。

### セキュリティ方針

- `contextIsolation: true`、`nodeIntegration: false` — レンダラーはサンドボックス化されている。
- `index.html` の CSP: `default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'` — インラインスクリプト・外部リソースは禁止。
- すべての CSS テーマは `styles.css` の `:root` で定義された CSS カスタムプロパティを使用。ダークテーマのみ。
