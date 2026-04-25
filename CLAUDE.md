# @bdtv/note-orc

Local voice-to-text dictation and LLM note tidying for Obsidian. No cloud dependencies. Ships as an NPM package with a CLI binary (`olt`).

Published under the `@bdtv` npm organisation. Install with `npm install -g @bdtv/note-orc`.

## Architecture

Three services, one lifecycle:

```
[Docker — GPU-accelerated via named volumes]
  whisper.cpp  :8088   speech → text  (GGML model, ffmpeg auto-converts non-WAV audio)
  Ollama       :11434  text → tidied  (qwen2.5:7b or user-selected model)

[Host Node process — started by olt serve]
  Tidy API     :3456   HTTP bridge: Obsidian hotkey → read vault file → Ollama → write back
                       Also exposes /tidy-text for selection-based tidying (plain text in/out)

[Obsidian]
  Whisper plugin      → POSTs audio to localhost:8088/inference for transcription
  Shell Commands      → hotkeys fire curl to localhost:3456/tidy or /tidy-text
```

The tidy API runs on the host (not in Docker) so it can access the vault filesystem directly. Whisper and Ollama run in Docker with GPU passthrough. Model files persist in named Docker volumes across container restarts.

## Project layout

```
src/
  index.ts                   CLI entry — registers all commands with Commander
  types.ts                   Shared TypeScript interfaces (AppConfig, TidyMode, etc.)
  commands/
    setup.ts                 TUI wizard — GPU detect, model download, vault find, Obsidian config
    obsidian-setup.ts        Plugin config writer — used by wizard + standalone command
    serve.ts                 Start Docker services + tidy API (olt serve / olt serve -d)
    stop.ts                  Stop everything, kill tidy API PID (olt stop)
    status.ts                Health check all five components (olt status)
    transcribe.ts            Audio → text via whisper.cpp (olt transcribe)
    tidy.ts                  LLM tidy via CLI — file, folder, or stdin (olt tidy)
    extract-tasks.ts         Pull structured tasks from a note as JSON (olt extract-tasks)
    models.ts                List/switch/update Whisper and Ollama models (olt models)
  services/
    config.ts                Read/write ~/.bdtv-note-orc/config.json with deep merge
    gpu-detect.ts            NVIDIA / Apple Silicon / CPU-only detection
    whisper-client.ts        HTTP client for whisper.cpp /inference endpoint
    ollama-client.ts         HTTP client for Ollama /api/generate and /api/pull
    tidy-api.ts              node:http server — /tidy, /tidy-text, /health
    tidy-api-process.ts      Thin fork target for background daemon mode
    model-manager.ts         Whisper model download + Ollama model pull helpers
  prompts/
    light-tidy.md            Fix grammar/fillers, preserve tone. Placeholder: {text}
    deep-tidy.md             Restructure, add headings, extract action items. Placeholder: {text}
config/
  defaults.json              Default ports (whisper:8088, ollama:11434, api:3456), model catalogue
test-fixtures/               Real voice-note transcriptions for manual prompt evaluation
bin/olt.js                   Shebang shim → dist/index.js; suppresses ESM experimental warning
docker-compose.yml           whisper-gpu + ollama-gpu (gpu profile); whisper + ollama (cpu profile)
```

## Development

```bash
npm install
npm run build        # clean dist/ → tsc → copy src/prompts/*.md to dist/prompts/
npm run typecheck    # tsc --noEmit, zero errors required
npm test             # vitest unit tests (no Docker required)
npm link             # make olt available globally for local testing
```

`prepublishOnly` runs build + typecheck + tests. The `clean` step is part of `build` to ensure compiled test files never appear in `dist/`.

## Commands

| Command | What it does |
|---|---|
| `olt setup` | Full TUI wizard: GPU detect → model select/download → vault detect → Obsidian plugin config |
| `olt setup --show-hotkeys` | Print Shell Commands curl snippets for copy-paste |
| `olt obsidian-setup` | (Re)configure Obsidian plugins without re-running full setup — safe to run any time |
| `olt serve` | Start Docker services + tidy API (foreground, Ctrl+C to stop) |
| `olt serve -d` | Start everything in background; tidy API PID written to `~/.bdtv-note-orc/tidy-api.pid` |
| `olt stop` | Stop Docker services + kill background tidy API |
| `olt status` | Health check: Docker, Whisper, Ollama, Tidy API, Vault. Uses `127.0.0.1` to avoid IPv6 timeout |
| `olt transcribe <file>` | Transcribe audio file. Flags: `--stdin`, `--to-obsidian <name>` |
| `olt tidy --file <path>` | LLM tidy a note. Flags: `--deep`, `--dry-run`, `--folder <dir>`, `--stdin` |
| `olt extract-tasks --file <path>` | Extract action items as JSON `[{title, priority}]`. Flags: `--stdin` |
| `olt models` | List installed Whisper and Ollama models with size and install status |
| `olt models use-llm <name>` | Switch Ollama model (pulls via running Ollama API) |
| `olt models use-whisper <name>` | Switch Whisper model (downloads into Docker volume) |
| `olt models update` | Re-pull current Whisper and Ollama models |

## Obsidian Integration

`olt setup` and `olt obsidian-setup` write directly to `.obsidian/` in the vault. Obsidian must be **fully restarted** (quit and reopen) after running either command.

| File written | What we set |
|---|---|
| `.obsidian/plugins/whisper/data.json` | `apiUrl: http://localhost:8088/inference` (full endpoint URL, not just host) |
| `.obsidian/plugins/obsidian-shellcommands/data.json` | Four shell commands (see hotkeys below) |
| `.obsidian/hotkeys.json` | Hotkey bindings for all four commands |
| `.obsidian/community-plugins.json` | Ensures both plugins appear in the enabled list |

### Hotkeys

| Hotkey | Command | API call |
|---|---|---|
| `Ctrl+Shift+T` | Tidy note (light) | `POST /tidy` with `{file, mode:"light"}` |
| `Ctrl+Shift+D` | Tidy note (deep) | `POST /tidy` with `{file, mode:"deep"}` |
| `Ctrl+Shift+Alt+T` | Tidy selection (light) | `POST /tidy-text?mode=light` with selected text as plain body |
| `Ctrl+Shift+Alt+D` | Tidy selection (deep) | `POST /tidy-text?mode=deep` with selected text as plain body |

All four commands use `execution_notification_mode: "permanent"` — a "Executing…" notification appears immediately so the user knows the command is running.

File tidy (`/tidy`) returns plain text `"✅ Light tidy done (3.2s)"` displayed as a notification on completion.

Selection tidy (`/tidy-text`) returns the tidied plain text which the Shell Commands plugin inserts at the cursor position, replacing the selection. Uses `curl -sf` so non-2xx responses fail silently rather than inserting error text into the note.

### Deduplication

The tidy API tracks in-progress requests per file path (for `/tidy`) and a global `"selection"` key (for `/tidy-text`). A duplicate request while one is active returns HTTP 429 with `"⏳ Already tidying this note — please wait"`.

### Shell Commands quoting (Windows)

Shell Commands defaults to PowerShell on Windows. The file tidy commands use **single-quoted JSON** for the `-d` argument because PowerShell single-quoted strings are literal — no backslash escaping. Using double-quoted strings with `\"` inside would be parsed by PowerShell before reaching curl.

Selection tidy commands use `--data-binary @-` to pipe stdin (the `{{selection}}` variable) directly to curl, avoiding all quoting issues.

## Config

Stored at `~/.bdtv-note-orc/config.json`. Written by `olt setup`, updated by `olt models use-*`.

```jsonc
{
  "whisper":  { "model": "ggml-large-v3", "port": 8088 },
  "ollama":   { "model": "qwen2.5:7b",    "port": 11434 },
  "api":      { "port": 3456 },
  "gpu":      { "detected": true, "type": "nvidia", "device": "RTX 5080" },
  "obsidian": { "vault": "C:\\Users\\...\\Obsidian Vault" },
  "prompts":  { "light": null, "deep": null }
}
```

`prompts.light` / `prompts.deep` can be absolute paths to override bundled templates. Convention-based override at `~/.bdtv-note-orc/prompts/light-tidy.md` is checked first.

## Tidy API Endpoints

### `POST /tidy`
Body: `{"file": "relative/path.md", "mode": "light"|"deep"}`
- Reads the file from vault, sends to Ollama, writes back
- Returns: plain text `"✅ Light tidy done (3.2s)"` on success
- Returns: 429 if the same file is already being tidied

### `POST /tidy-text?mode=light|deep`
Body: plain text (the selected text)
- Sends text directly to Ollama without touching the filesystem
- Returns: plain text (the tidied text)
- Returns: 429 if a selection tidy is already in progress

### `GET /health`
Returns: `{"status":"ok","ollama":bool,"whisper":bool,"vault":"..."}`

### Security
- Binds to `127.0.0.1` only
- Path traversal: `validateFilePath()` rejects `..` in path and asserts resolved path starts with `vault + path.sep`
- Body size capped at 1 MB

## Docker Compose

Project name: `bdtv-note-orc` (set via `name:` in docker-compose.yml, making volume names predictable).

Named volumes created by compose:
- `bdtv-note-orc_whisper-models` — Whisper GGML model files
- `bdtv-note-orc_ollama-models` — Ollama model blobs

**Important**: Model downloads during `olt setup` must target these exact volume names (with the `bdtv-note-orc_` prefix) so the running containers find them. `setup.ts` and `model-manager.ts` hardcode these names.

### Whisper container entrypoint

The official `ghcr.io/ggml-org/whisper.cpp:main` image uses `ENTRYPOINT ["bash", "-c"]`. When Docker Compose passes a `command:` string, the args don't survive correctly through the double-shell wrapping. The fix is an explicit `entrypoint:` override in docker-compose.yml:

```yaml
entrypoint: >
  /bin/sh -c "/app/build/bin/whisper-server
  --host 0.0.0.0
  --convert
  -m /models/${WHISPER_MODEL:-ggml-base.en.bin}"
```

Key flags:
- `--host 0.0.0.0` — required so Docker's port proxy can reach the server (default is `127.0.0.1` inside the container)
- `--convert` — enables ffmpeg auto-conversion of non-WAV audio (Obsidian records WebM/Opus)

`olt serve` passes `WHISPER_MODEL`, `WHISPER_PORT`, and `OLLAMA_PORT` as env vars to docker compose.

## Windows-Specific Notes

- **Port 8088** — Docker Desktop's backend process occupies port 8080 on Windows. Whisper uses 8088 by default.
- **GPU detection** — `nvidia-ctk` is NOT required on Windows. Docker Desktop handles GPU passthrough via the WSL2 backend. `gpu-detect.ts` only checks for `nvidia-smi` on `win32`.
- **Docker Compose** — always use `docker compose` (v2 plugin, two words), never `docker-compose` (v1 standalone).
- **Status checks** — use `127.0.0.1` explicitly, not `localhost`. On Windows, `localhost` resolves to IPv6 `::1` first, which causes a 2-second timeout before falling back to IPv4, failing the health check.
- **Obsidian config path** — `%APPDATA%\Obsidian\obsidian.json`, not `~/.config/obsidian/`.

## Model Sources

Whisper models: `huggingface.co/ggerganov/whisper.cpp/resolve/main/{model}.bin`

| Model | Size | Notes |
|---|---|---|
| `ggml-tiny.en` | 75 MB | Very fast, lower accuracy |
| `ggml-base.en` | 142 MB | Default — good balance |
| `ggml-small.en` | 466 MB | Better for accents |
| `ggml-medium.en` | 1.5 GB | Meeting transcriptions |
| `ggml-large-v3` | 3.1 GB | Best accuracy |

Ollama models (official library only): `llama3.2:3b`, `qwen2.5:7b` (default), `phi4:14b`

## Testing

```bash
npm test              # unit tests only, no Docker required
```

Unit test coverage:
- `config.test.ts` — round-trip, deep merge, corrupt file fallback
- `gpu-detect.test.ts` — all three detection paths
- `tidy-api.test.ts` — path traversal security, `/tidy-text` endpoint, deduplication (429 on concurrent requests)

Integration tests require `olt serve` running — test manually using `olt status` and `test-fixtures/`.

## Setup Flow (What `olt setup` Does)

1. Check Docker daemon running
2. Detect GPU (NVIDIA via `nvidia-smi`, Apple Silicon via platform/arch, else CPU)
3. Prompt: select Whisper model
4. Prompt: select Ollama model
5. Prompt: locate Obsidian vault (auto-detects from Obsidian config, falls back to prompt)
6. Confirm selections before downloading
7. Pull `ghcr.io/ggml-org/whisper.cpp:main` Docker image
8. Pull `ollama/ollama:latest` Docker image
9. Download Whisper model into `bdtv-note-orc_whisper-models` volume via `alpine/curl`
10. Start temporary Ollama container (with `bdtv-note-orc_ollama-models` volume), poll until ready, pull LLM, stop container
11. Write `~/.bdtv-note-orc/config.json`
12. If Whisper + Shell Commands plugins detected: auto-configure via `configureObsidianPlugins()`
13. If plugins missing: show install instructions + tell user to run `olt obsidian-setup`

## Publishing

```bash
npm run build
npm run typecheck
npm test
npm publish --access public    # requires @bdtv org on npmjs.com
```

The `@bdtv` npm organisation must exist and the publisher must be a member before scoped publish works. Create at npmjs.com → Your profile → Add organisation → `bdtv`.
