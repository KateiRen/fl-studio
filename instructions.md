# FL Studio

This was an afternoon of vibe coding for curiosity. Is it possible to create a simple, modern and user friendly GUI around Microsoft Foundry Local to make it accessible not only in a developer setups and shipped applications, but let it stand as its own application to 
- visually browse the model catalogue
- evaluate and show available execution provider on the current machine
- load and test models from the catalogue with an easy chat mode and RAG mode for documents.



A desktop GUI for [Foundry Local](https://learn.microsoft.com/azure/ai-foundry/foundry-local/), mimicking the functionality and look & feel of [LM Studio](https://lmstudio.ai/).

## Architecture decisions

- **Shell**: Electron + React + TypeScript (via `electron-vite`), not a web app — needed for native Foundry Local SDK access, local filesystem (SQLite history, RAG store), and drag-and-drop file ingestion without a browser sandbox.
- **Foundry Local integration**: native `foundry-local-sdk` (Node-API addon) used directly from the Electron main process — no shelling out to the `foundry` CLI.
- **Security**: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. All Foundry Local/DB/RAG access lives in the main process; the renderer only talks through a typed `contextBridge` API (`window.api`).
- **Hardware detection**: sourced entirely from the SDK's execution-provider (EP) discovery — no OS-level hardware probing.
- **Chat history**: persisted locally via `better-sqlite3` (conversations + messages).
- **RAG store**: in-memory + JSON-backed per-conversation document store (MVP scope — no dedicated vector DB).
- **Local server**: the app starts/stops and surfaces Foundry Local's own built-in OpenAI-compatible web service rather than running a custom proxy.

## Capabilities

### 1. Model catalog browsing
- List Foundry Local's model catalog.
- Display the host's registered execution providers (CPU/GPU/NPU) as reported by the SDK.
- Flag/filter models by likely fit for the available hardware (e.g. NPU/GPU-optimized variants vs. CPU-only).
- Acceptance: catalog view matches `foundry model list` output; hardware panel matches SDK-reported EP devices; filtering by device/task/search narrows the grid correctly.

### 2. Download, load, and chat
- Download a model from the catalog with progress reporting and cancellation.
- Load/unload a downloaded model into a running Foundry Local instance.
- Chat against a loaded model with streaming responses.
- Acceptance: downloading `qwen2.5-0.5b` (or similar) via the UI is reflected in `foundry cache list`; chat responses stream incrementally; multiple conversations persist across app restarts.

### 3. Document drag-and-drop (RAG) + OpenAI-compatible server
- Drag PDF/TXT/MD/DOCX files into a chat to ground responses in their content (chunk, embed via a loaded embedding model, retrieve top-k by cosine similarity, inject as context).
- Start/stop Foundry Local's embedded OpenAI-compatible server and surface its endpoint for external use (e.g. `curl`).
- Acceptance: dragging a document into chat measurably changes the answer to a question about its content; the local server responds to an external OpenAI-compatible request while running.

## Out of scope (for now)
- `foundry-local-sdk-winml` (Windows-only NPU/GPU auto EP management).
- Packaging/code-signing via `electron-builder` (dev-only for now).
- Vector database / persistent embeddings store beyond the JSON MVP store.
