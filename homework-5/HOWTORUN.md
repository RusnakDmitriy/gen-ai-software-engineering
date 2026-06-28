# HOWTORUN — Custom FastMCP Server (`lorem-ipsum`)

This guide explains how to **install dependencies**, **run the server**, **connect the MCP
configuration** in Cursor, and **use/test the `read` tool**.

All commands are run from the `custom-mcp-server/` directory unless stated otherwise.

```bash
cd homework-5/custom-mcp-server
```

## 1. Install dependencies

Create a virtual environment and install the requirements (which include `fastmcp`):

```bash
python3 -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Verify `fastmcp` is installed:

```bash
python -c "import fastmcp; print('fastmcp', fastmcp.__version__)"
```

## 2. Run the server

The server speaks MCP over **stdio**, so it is normally launched by the MCP client
(Cursor). You can still start it manually to confirm it boots:

```bash
# Option A — run the script directly
python server.py

# Option B — use the FastMCP CLI
fastmcp run server.py
```

You should see the FastMCP banner and `Starting MCP server`. Press `Ctrl+C` to stop.
(When launched manually it waits for an MCP client on stdin; this is expected.)

## 3. Connect the MCP configuration

The server is registered as `lorem-ipsum` in the workspace-root `.cursor/mcp.json` (the
config Cursor loads for this workspace). It is also present in
`homework-5/.cursor/mcp.json` for reference:

```json
{
  "mcpServers": {
    "lorem-ipsum": {
      "command": "${workspaceFolder}/homework-5/custom-mcp-server/.venv/bin/python",
      "args": [
        "${workspaceFolder}/homework-5/custom-mcp-server/server.py"
      ]
    }
  }
}
```

Notes:
- `${workspaceFolder}` is the repository root (the folder opened in Cursor).
- The `command` points at the **virtual environment's** Python so that `fastmcp` is
  available. If you used a different path or a global install, update `command`
  accordingly (e.g. just `python`).
- After editing the config, reload/restart Cursor (or toggle the server in
  **Settings → MCP**) so the `lorem-ipsum` server is picked up. Once connected you should
  see the `read` tool listed.

## 4. Use / test the `read` tool

### A. From Cursor (the intended usage)

Ask the agent something like:

> Use the `read` tool from the `lorem-ipsum` server to return 10 words.

The model calls `read(word_count=10)` and returns exactly 10 words from `lorem-ipsum.md`.
Calling it with no argument returns the default **30** words.

### B. Programmatically (in-memory client, no Cursor needed)

This is the quickest way to verify behavior:

```bash
source .venv/bin/activate
python - <<'PY'
import asyncio
from fastmcp import Client
from server import mcp

async def main():
    async with Client(mcp) as c:
        print("tools:", [t.name for t in await c.list_tools()])
        print("read() default:", (await c.call_tool("read", {})).data)
        print("read(5):", (await c.call_tool("read", {"word_count": 5})).data)
        rr = await c.read_resource("lorem://words/7")
        print("resource(7):", rr[0].text)

asyncio.run(main())
PY
```

Expected:
- `read()` returns **30** words.
- `read(5)` returns **5** words.
- resource `lorem://words/7` returns **7** words.

## Troubleshooting

- **`ModuleNotFoundError: No module named 'fastmcp'`** — the config's `command` is not
  pointing at the venv Python, or dependencies weren't installed. Re-run step 1 and check
  the path in step 3.
- **Server not appearing in Cursor** — confirm the JSON is valid and restart Cursor.
- **Wrong word count** — `word_count` must be a non-negative integer; values larger than
  the file's word count return the full text.
