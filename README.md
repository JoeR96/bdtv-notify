# @bdtv/notify

> Local voice-to-text dictation and LLM note tidying for Obsidian — no cloud, no API keys, no subscriptions.

Record a voice note in Obsidian. Press a hotkey. Get a clean, structured document back — summaries, headings, action items — all processed locally on your machine using open-source models.

---

## What it does

`@bdtv/notify` wires together three local services behind a single CLI (`olt`):

| Service | What it does |
|---|---|
| **whisper.cpp** | Converts your voice recordings to text using OpenAI's Whisper model, running entirely on your hardware |
| **Ollama** | Runs a local language model (e.g. Qwen 2.5 7B) that cleans up and restructures the transcription |
| **Tidy API** | A local HTTP server that bridges Obsidian hotkeys to Ollama — press a key, the note updates in place |

Everything runs in Docker. Your audio never leaves your machine.

---

## Install

```bash
npm install -g @bdtv/notify
```

**Requirements**: Node ≥ 20, Docker Desktop

---

## Quick start

```bash
# 1. First-time setup — pulls images, downloads models, finds your vault, configures Obsidian
olt setup

# 2. Start everything
olt serve

# 3. In Obsidian: record a voice note with the Whisper plugin, then press Ctrl+Shift+D
```

---

## Hotkeys (configured automatically by olt setup)

| Hotkey | Action |
|---|---|
| `Ctrl+Shift+T` | Light tidy — fix grammar, remove fillers, preserve tone |
| `Ctrl+Shift+D` | Deep tidy — add summary, headings, and action items |
| `Ctrl+Shift+Alt+T` | Light tidy **selected text** → replaces selection |
| `Ctrl+Shift+Alt+D` | Deep tidy **selected text** → replaces selection |

---

## CLI reference

```
olt setup              Interactive wizard: GPU detect, model download, vault + Obsidian config
olt setup --show-hotkeys   Print the Shell Commands curl snippets for manual setup
olt obsidian-setup     Re-run Obsidian plugin config without redoing full setup
olt serve              Start all services (Ctrl+C to stop)
olt serve -d           Start in background
olt stop               Stop everything
olt status             Health check — Docker, Whisper, Ollama, Tidy API, Vault
olt transcribe <file>  Transcribe an audio file to text
olt tidy --file <path> Tidy a note from the CLI (--deep, --dry-run, --folder, --stdin)
olt extract-tasks      Pull structured action items from a note as JSON
olt models             List, switch, and update Whisper and Ollama models
```

---

## How tidy works

**Light tidy** cleans up what's there without changing the substance:
- Removes filler words (um, uh, like, you know, sort of)
- Fixes grammar and sentence boundaries
- Preserves your tone and vocabulary exactly

**Deep tidy** restructures the content into a proper document:
- Adds a 2–3 sentence summary at the top
- Groups related ideas under descriptive headings
- Extracts action items into a dedicated section
- Preserves technical terms and domain-specific language

Both modes protect against duplicate requests — pressing the hotkey twice while a tidy is running shows `⏳ Already tidying this note — please wait` instead of duplicating work.

---

## Obsidian setup

`olt setup` handles everything automatically if the plugins are already installed. If you're starting fresh:

1. Install **Whisper** (by Nik Danilov) from Obsidian's community plugin browser
2. Install **Shell Commands** (by Jarkko Linnanvirta) from the same browser
3. Run `olt setup` — it detects both plugins and writes all config directly to your vault
4. Restart Obsidian

That's it. No manual config, no copy-pasting curl commands.

---

## Models

### Whisper (speech-to-text)

| Model | Size | Best for |
|---|---|---|
| `ggml-tiny.en` | 75 MB | Quick notes on low-power hardware |
| `ggml-base.en` | 142 MB | Default — best balance |
| `ggml-small.en` | 466 MB | Accents and longer recordings |
| `ggml-medium.en` | 1.5 GB | Meeting transcriptions |
| `ggml-large-v3` | 3.1 GB | Maximum accuracy |

### Ollama (language models)

| Model | Best for |
|---|---|
| `llama3.2:3b` | Fast tidying on lower-spec hardware |
| `qwen2.5:7b` | Default — excellent instruction following |
| `phi4:14b` | Highest quality restructuring |

Switch models any time:
```bash
olt models use-whisper ggml-small.en
olt models use-llm phi4:14b
```

---

## GPU support

- **NVIDIA** — GPU acceleration via Docker + NVIDIA Container Toolkit (auto-detected)
- **Apple Silicon** — Ollama uses Metal natively; Whisper runs CPU in Docker
- **CPU-only** — works on any hardware, just slower on large models

---

## Architecture

```
[Docker]
  whisper.cpp  :8088   — GGML model, ffmpeg converts non-WAV audio automatically
  Ollama       :11434  — LLM, GPU-accelerated

[Host]
  Tidy API     :3456   — node:http server; reads/writes vault files; 127.0.0.1 only

[Obsidian]
  Whisper plugin  → localhost:8088/inference
  Shell Commands  → localhost:3456/tidy or /tidy-text
```

Model files persist in named Docker volumes across restarts. The tidy API runs on the host (not in Docker) so it can access your vault filesystem directly.

---

## License

MIT — [JoeR96/bdtv-notify](https://github.com/JoeR96/bdtv-notify)
