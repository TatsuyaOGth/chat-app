# テスト運用方針

### 目的

このリポジトリのテストは、実装の正しさを広く証明することよりも、壊れやすい経路の回帰を早く検知することを優先する。
特に次の 4 点を継続的に守る。

- Ollama とのストリーミング通信が壊れないこと
- Main と Renderer の IPC 契約が崩れないこと
- Renderer の生成中状態とキャンセル状態が破綻しないこと
- Preset と Session の保存データが壊れないこと

### 前提

- このアプリは Electron の Main、Preload、Renderer の 3 層で構成される
- 通常の自動テストでは Ollama 実機に依存しない
- Ollama 実機確認は任意ジョブまたは手動確認に分離する
- 現時点ではカバレッジの閾値で CI を落とさない

### テスト優先順位

優先度は次の順とする。

1. Main の純粋ロジックとストリーミング処理
2. IPC ハンドラと HTTP モックを使った統合テスト
3. Renderer の状態遷移と requestId によるイベント分離
4. Storage の CRUD と migration
5. Markdown サニタイズと Preload の公開 API 境界
6. Ollama 実機を使う任意 E2E

### テスト階層

#### Tier 1: ユニットテスト

常時実行対象。高速で外部依存を持たない。

- buildChatBody の入力整形
- ストリームの JSON 行処理
- timeout と error 分岐
- presets と sessions の CRUD
- templates から presets への migration
- Markdown サニタイズ設定

#### Tier 2: 統合テスト

常時実行対象。HTTP はモックし、Ollama 実機には接続しない。

- ollama:get-models
- ollama:chat
- ollama:chat:cancel
- requestId ごとの chunk ルーティング
- Renderer の生成開始、完了、失敗、キャンセルの遷移

#### Tier 3: 任意 E2E

CI の任意ジョブまたはローカルで実行する。Ollama または Docker を使って実施する。

- 実際のモデル取得
- 実ストリームでの応答生成
- 長文応答とキャンセル
- 起動から送信完了までの通し確認

#### Tier 4: 手動スモーク

リリース前に実施する。

- アプリ起動
- モデル一覧取得
- 送信と応答表示
- キャンセル
- Preset 保存と再選択
- Session 保存と再読込
- Markdown 表示とコードブロック表示

### 推奨ツールチェーン

最小構成は次を推奨する。

- Jest: ユニットテストと統合テスト
- nock: Ollama HTTP のモック
- c8: カバレッジ可視化

導入時は package.json に次の scripts を追加する。

- test: Tier 1 と Tier 2 を一括実行
- test:unit: ユニットテストのみ
- test:integration: 統合テストのみ
- test:e2e: 任意 E2E
- test:coverage: c8 付き実行

### 初期テストファイル設計

最初のテスト構成は次を基準にする。

- tests/unit/main.buildChatBody.test.js
- tests/unit/main.stream-parser.test.js
- tests/unit/storage.presets.test.js
- tests/unit/storage.sessions.test.js
- tests/integration/ipc.ollama.get-models.test.js
- tests/integration/ipc.ollama.chat-stream.test.js
- tests/integration/ipc.ollama.cancel.test.js
- tests/integration/renderer.request-routing.test.js
- tests/security/renderer.markdown-sanitize.test.js
- tests/optional-e2e/ollama.real-stream.test.js

テスト追加時は 1 ファイル 1 責務を守る。1 つのテストファイルで Main と Renderer の複数責務を同時に検証しない。

### 先に実装するべきテストケース

最低限、次のケースから着手する。

1. chat ストリームが 3 チャンクで正常完了し、done が 1 回だけ通知される
2. 途中に不正 JSON が混ざっても残りのチャンク処理が継続する
3. 無通信が 30 秒続いたとき timeout エラーになる
4. HTTP 503 または 500 で onDone せず onError に遷移する
5. 並行 request で requestId ごとに chunk が分離される
6. cancel 実行時に in-flight request が中断され cancelled=true が返る
7. system 未指定時に system message を先頭挿入しない
8. options の null と undefined を送信 body から除外する
9. templates から presets への migration が既存データを壊さない
10. Renderer の isGenerating と currentRequestId が開始、完了、失敗、キャンセルで整合する
11. Markdown の script 系要素と危険属性が除去される
12. Preload が想定チャネル以外を Renderer に公開しない

### 実装時のルール

- まず Tier 1 を追加し、その次に Tier 2 を追加する
- E2E を先に増やさない
- Main のロジックが直接テストしづらい場合は、小さく helper を分離してからテストを書く
- Renderer 全体を一気にテストしようとせず、requestId 分離、生成状態、キャンセルのように小さい責務へ分ける
- 実装変更と同時に、その変更が触る責務に対応するテストを最低 1 件追加する
- バグ修正時は、まず再現テストを追加してから修正する

### CI 運用

通常の CI では Tier 1 と Tier 2 のみを実行する。

- PR 作成時: test を実行
- main または develop への反映前: test と test:coverage を実行
- 任意ジョブ: test:e2e を手動起動できるようにする

E2E を通常ジョブへ含めない理由は、Ollama 実機依存で不安定要因が増えるためである。

### 手動確認の運用

次の変更では手動スモークを必須にする。

- src/main.js を変更したとき
- src/preload.js を変更したとき
- src/renderer/renderer.js の送受信処理を変更したとき
- storage 仕様や migration を変更したとき
- Markdown 表示やサニタイズ設定を変更したとき

### 失敗時の切り分け

テスト失敗時は次の順で切り分ける。

1. Main の純粋ロジック破損か
2. Ollama HTTP モック条件の不整合か
3. IPC 契約の破損か
4. Renderer 側の状態遷移破損か
5. Storage の既存データ前提破損か

原因が複数層にまたがる場合でも、1 回の修正で広範囲を触らず、壊れた境界から順に直す。

### 今後の拡張方針

将来テストを増やす場合は、次の順で拡張する。

1. Main の helper 分離を進めてユニットテスト対象を増やす
2. Preload の公開 API を契約テスト化する
3. Renderer の送受信周辺を小さいモジュールへ切り出す
4. Ollama 実機 E2E を release 前ジョブとして安定化する
