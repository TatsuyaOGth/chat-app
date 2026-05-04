# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start        # Launch the Electron app (requires Ollama running locally)
```

There is no build step, no bundler, no transpiler, and no test suite. JavaScript is loaded directly by Electron.

**Prerequisite:** Ollama must be running on `localhost:11434` before launching the app. Install models with `ollama pull <model>` (e.g. `ollama pull llama3`).

## Architecture

This is an Electron desktop app that provides a chat UI for locally-running Ollama LLMs. It follows the standard Electron three-process model:

```
Renderer (browser context)
  └─ window.ollama API (exposed via contextBridge in preload.js)
       └─ IPC (ipcRenderer.invoke / ipcRenderer.send)
            └─ Main process (src/main.js)
                 └─ HTTP to Ollama at localhost:11434
```

### Process boundaries

- **`src/main.js`** — Main process. Owns all network I/O (Node.js `http` module). Implements two IPC handlers:
  - `ollama:get-models` (invoke) — calls `GET /api/tags`, returns model name list.
  - `ollama:chat` (on) — starts a streaming POST to `/api/chat`, forwards newline-delimited JSON chunks back to the renderer as `ollama:chat:chunk` events, or `ollama:chat:error` on failure. Returns an abort function but does not expose it via IPC (streaming cannot be cancelled from the renderer currently).

- **`src/preload.js`** — Runs with Node.js access but in the renderer's context. Uses `contextBridge.exposeInMainWorld('ollama', ...)` to expose a typed, minimal API. The renderer has zero direct Node.js or network access — all Ollama calls must go through this bridge.

- **`src/renderer/`** — Plain HTML/CSS/JS, no framework. `renderer.js` manages UI state (`messages[]`, `isGenerating`, `requestCounter`), renders chat bubbles, and subscribes/unsubscribes to IPC chunk events per-request using the `requestId` pattern to avoid cross-request bleed.

### IPC event flow for streaming

1. Renderer calls `window.ollama.chat(requestId, model, messages)` (fire-and-forget `ipcRenderer.send`).
2. Main process opens a streaming HTTP connection to Ollama, parses newline-delimited JSON.
3. Each token fires `ollama:chat:chunk` → `{ requestId, content, done: false }` back to renderer.
4. Final chunk fires `{ requestId, content: '', done: true }`.
5. Renderer filters events by `requestId` and tears down listeners in `finish()`.

### Security posture

- `contextIsolation: true`, `nodeIntegration: false` — renderer is sandboxed.
- CSP in `index.html`: `default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'` — no inline scripts, no external resources.
- All CSS theming uses CSS custom properties defined in `:root` in `styles.css`. Dark theme only.
