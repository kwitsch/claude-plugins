# graphify reference: query, path, explain

Load when user asks question against existing graph, or runs `/graphify path` or `/graphify explain`. Core query stub points here for full traversal flow.

Two traversal modes — pick based on question:

| Mode | Flag | Best for |
|------|------|----------|
| BFS (default) | _(none)_ | "What is X connected to?" - broad context, nearest neighbors first |
| DFS | `--dfs` | "How does X reach Y?" - trace specific chain or dependency path |

### Step 0 — Constrained query expansion (REQUIRED before traversal)

graphify's `query` CLI matches nodes via case-folded substring + IDF — **no stemming, no synonyms, no cross-language match** inside binary. If user's question uses different language or domain vocab than graph labels (user says "обработчик" / graph says "handler"; user says "authentication" / graph says "Guardian"), literal matcher returns 0 hits and answer collapses to noise.

Fix **without inventing tokens** by expanding query against actual graph vocab first:

1. Extract token vocab from node labels:
```bash
$(cat graphify-out/.graphify_python) -c "
import json, re
from pathlib import Path
data = json.loads(Path('graphify-out/graph.json').read_text())
vocab = set()
for n in data['nodes']:
    for c in re.findall(r'[^\W\d_]+', n.get('label','') or '', re.UNICODE):
        parts = re.findall(r'[A-Z]+(?=[A-Z][a-z])|[A-Z]?[a-z]+|[A-Z]+', c) or [c]
        for p in parts:
            t = p.lower()
            if 3 <= len(t) <= 30:
                vocab.add(t)
Path('graphify-out/.vocab.txt').write_text('\n'.join(sorted(vocab)))
print(f'vocab: {len(vocab)} tokens')
"
```

2. Read `graphify-out/.vocab.txt`. For user's question, select **up to 12 tokens from this exact list** that semantically match query intent. Hard constraints:
   - MUST pick only tokens present in vocab file. Do NOT invent tokens.
   - If query concept has no plausible token in vocab, skip — do not substitute near-synonym from training memory.
   - If **no** vocab tokens match query, output empty list and tell user corpus has no relevant vocab for question. Do not fabricate search.
   - Cross-language: Russian "аутентификация" → look for `auth`, `credential`, `token`, `security` IFF present in vocab.
   - Morphology: "handlers" maps to `handler` IFF present; "todos" maps to `todo` IFF present.

3. Print selection to user before running query:
```
Query expanded to (from graph vocab, N tokens): [token1, token2, ...]
```
If list empty, say so and stop — do not proceed to traversal.

### Step 1 — Traversal

Build **expanded query string** by joining selected tokens with spaces. Use as `QUESTION` below — NOT original user question. (Original preserved only for `save-result` at end.)

```bash
graphify query "QUESTION"
# or: graphify query "QUESTION" --dfs --budget 3000
```

Answer using **only** graph output. Quote `source_location` when citing specific fact. If graph lacks enough info, say so — do not hallucinate edges.

After writing answer, save back into graph to improve future queries. Include expanded tokens inside `--answer` text (e.g. `"Expanded from original query via vocab: [tokens]. Then traversed..."`) so next `--update` extracts expansion history as graph node:

```bash
$(cat graphify-out/.graphify_python) -m graphify save-result --question "ORIGINAL_QUESTION" --answer "ANSWER" --type query --nodes NODE1 NODE2
```

Replace `ORIGINAL_QUESTION` with user's verbatim question, `ANSWER` with full answer text (containing expanded-token trace), `NODE1 NODE2` with cited node labels. Closes feedback loop: next `--update` extracts Q&A as graph node.

---

## For /graphify path

Find shortest path between two named concepts in graph.

```bash
graphify path "NODE_A" "NODE_B"
```

Replace `NODE_A` and `NODE_B` with actual concept names. Explain path in plain language — what each hop means, why significant.

After explanation, save back:

```bash
$(cat graphify-out/.graphify_python) -m graphify save-result --question "Path from NODE_A to NODE_B" --answer "ANSWER" --type path_query --nodes NODE_A NODE_B
```

---

## For /graphify explain

Plain-language explanation of single node — everything connected to it.

```bash
graphify explain "NODE_NAME"
```

Replace `NODE_NAME` with concept user asked about. Write 3-5 sentence explanation: what node is, what it connects to, why connections significant. Use source locations as citations.

After explanation, save back:

```bash
$(cat graphify-out/.graphify_python) -m graphify save-result --question "Explain NODE_NAME" --answer "ANSWER" --type explain --nodes NODE_NAME
```