# graphify reference: add a URL and watch a folder

Load when user ran `/graphify add <url>` or passed `--watch`. Neither part of default build.

## For /graphify add

Fetch URL, add to corpus, update graph.

```bash
$(cat graphify-out/.graphify_python) -c "
import sys
from graphify.ingest import ingest
from pathlib import Path

try:
    out = ingest('URL', Path('./raw'), author='AUTHOR', contributor='CONTRIBUTOR')
    print(f'Saved to {out}')
except ValueError as e:
    print(f'error: {e}', file=sys.stderr)
    sys.exit(1)
except RuntimeError as e:
    print(f'error: {e}', file=sys.stderr)
    sys.exit(1)
"
```

Replace `URL` with actual URL, `AUTHOR` with user's name if provided, `CONTRIBUTOR` likewise. If command exits with error, tell user what went wrong — no silent continue. After successful save, auto-run `--update` pipeline on `./raw` to merge new file into existing graph.

Supported URL types (auto-detected):
- YouTube / any video URL → audio downloaded via yt-dlp, transcribed to `.txt` on next run (requires `pip install 'graphifyy[video]'`)
- Twitter/X → fetched via oEmbed, saved as `.md` with tweet text and author
- arXiv → abstract + metadata saved as `.md`
- PDF → downloaded as `.pdf`
- Images (.png/.jpg/.webp) → downloaded, Claude vision extracts on next run
- Any webpage → converted to markdown via html2text

---

## For --watch

Start background watcher, monitors folder, auto-updates graph when files change.

```bash
python3 -m graphify.watch INPUT_PATH --debounce 3
```

Replace `INPUT_PATH` with folder to watch. Behavior depends on what changed:

- **Code files only (.py, .ts, .go, etc.):** re-runs AST extraction + rebuild + cluster immediately, no LLM needed. `graph.json` and `GRAPH_REPORT.md` updated automatically.
- **Docs, papers, or images:** writes `graphify-out/needs_update` flag, prints notification to run `/graphify --update` (LLM semantic re-extraction required).

Debounce (default 3s): waits until file activity stops before triggering — wave of parallel agent writes won't trigger rebuild per file.

Press Ctrl+C to stop.

For agentic workflows: run `--watch` in background terminal. Code changes from agent waves picked up automatically between waves. If agents also write docs or notes, need manual `/graphify --update` after those waves.