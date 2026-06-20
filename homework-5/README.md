# Homework 5 — MCP Servers (GitHub, Filesystem, Custom FastMCP)

> **Student:** Rusnak Dmytro  
> **AI tool used:** [Cursor](https://cursor.com) (IDE + Cursor Agent CLI for pipeline execution)  
> **Detailed run guide:** [HOWTORUN.md](HOWTORUN.md)

## Description

This homework configures multiple **MCP (Model Context Protocol)** servers for use with
**Cursor** and builds one **custom MCP server** with **FastMCP**.

Configured servers (see `.cursor/mcp.json`):

| Server | Type | Purpose |
|--------|------|---------|
| `github` | Remote (HTTP) | Connects Cursor to GitHub via the official GitHub MCP endpoint. |
| `filesystem` | Local (npx) | Gives Cursor read access to a directory on the machine. |
| `lorem-ipsum` | Custom (FastMCP) | Our own server that exposes word-limited content from `lorem-ipsum.md`. |

This README focuses on **Task 4 — the custom FastMCP server**.

## Custom MCP Server (`custom-mcp-server/`)

```
custom-mcp-server/
├── server.py          # FastMCP server: resource + `read` tool
├── lorem-ipsum.md     # source text consumed by the resource/tool
└── requirements.txt   # dependencies (includes fastmcp)
```

The server exposes the contents of `lorem-ipsum.md` in two complementary ways.

### Resource vs. Tool — what's the difference?

- **Resources** are *URIs that Cursor can read from* (like files or APIs). They are
  passive data sources — the client decides when to read them. Our resource is
  `lorem://words/{word_count}`, which returns the requested number of words.
- **Tools** are *actions Cursor can call* to perform an operation (read a file, run a
  command, etc.). The client/model actively invokes them. Our tool is `read`, which
  takes an optional `word_count` and returns the same word-limited content.

### What it does

- **Resource** `lorem://words/{word_count}` — reads `lorem-ipsum.md` and returns exactly
  `word_count` words.
- **Tool** `read(word_count: int = 30)` — same behavior, callable by the model. Defaults
  to **30** words when no argument is given.

Words are split on whitespace; if `word_count` is larger than the file's word count, the
full text is returned.

## Quick verification

The server was verified with an in-memory FastMCP client:

- `read()` → returns **30** words (default)
- `read(word_count=5)` → returns **5** words
- resource `lorem://words/7` → returns **7** words

See **[HOWTORUN.md](./HOWTORUN.md)** for full install / run / connect / test instructions.

## Deliverables

- `custom-mcp-server/server.py` — FastMCP server with resource + `read` tool
- `custom-mcp-server/lorem-ipsum.md` — source text
- `custom-mcp-server/requirements.txt` — dependencies (includes `fastmcp`)
- `.cursor/mcp.json` — all servers registered (workspace-root config loaded by Cursor; `homework-5/.cursor/mcp.json` mirrors it)
- `HOWTORUN.md` — setup and usage instructions
- `docs/screenshots/` — screenshots of MCP call results
