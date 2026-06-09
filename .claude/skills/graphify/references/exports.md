# graphify reference: extra exports and benchmark

Load when user passed export flag (`--wiki`, `--neo4j`, `--neo4j-push`, `--svg`, `--graphml`, `--mcp`), or corpus large enough for token-reduction benchmark. Each step runs only for its own flag.

### Step 6b - Wiki (only if --wiki flag)

**Only run this step if `--wiki` was explicitly given in the original command.**

Run before Step 9 (cleanup) so `.graphify_labels.json` still available.

```bash
graphify export wiki
```

### Step 7 - Neo4j export (only if --neo4j or --neo4j-push flag)

**If `--neo4j`** - generate Cypher file for manual import:

```bash
graphify export neo4j
```

**If `--neo4j-push <uri>`** - push directly to running Neo4j instance. Ask user for credentials if not provided:

```bash
graphify export neo4j --push bolt://localhost:7687 --user neo4j --password PASSWORD
```

Default URI `bolt://localhost:7687`, default user `neo4j`. Uses MERGE — safe to re-run, no duplicates.

### Step 7b - SVG export (only if --svg flag)

```bash
graphify export svg
```

### Step 7c - GraphML export (only if --graphml flag)

```bash
graphify export graphml
```

### Step 7d - MCP server (only if --mcp flag)

```bash
python3 -m graphify.serve graphify-out/graph.json
```

Starts stdio MCP server exposing tools: `query_graph`, `get_node`, `get_neighbors`, `get_community`, `god_nodes`, `graph_stats`, `shortest_path`. Add to Claude Desktop or any MCP-compatible agent orchestrator for live graph queries.

Configure in Claude Desktop via `claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "graphify": {
      "command": "python3",
      "args": ["-m", "graphify.serve", "/absolute/path/to/graphify-out/graph.json"]
    }
  }
}
```

### Step 8 - Token reduction benchmark (only if total_words > 5000)

If `total_words` from `graphify-out/.graphify_detect.json` greater than 5,000, run:

```bash
graphify benchmark
```

Print output directly in chat. If `total_words <= 5000`, skip silently — graph value is structural clarity, not token compression, for small corpora.