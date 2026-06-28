"""Custom MCP server built with FastMCP.

Exposes the contents of ``lorem-ipsum.md`` as both:
  * a Resource (a URI Cursor can read from), and
  * a Tool named ``read`` (an action Cursor can call).

Both honor a ``word_count`` parameter (default: 30) and return exactly
that many words from the source file.
"""

from pathlib import Path

from fastmcp import FastMCP

DEFAULT_WORD_COUNT = 30
LOREM_IPSUM_FILE = Path(__file__).parent / "lorem-ipsum.md"

mcp = FastMCP("lorem-ipsum-server")


def _read_words(word_count: int = DEFAULT_WORD_COUNT) -> str:
    """Return the first ``word_count`` words from ``lorem-ipsum.md``.

    Words are split on whitespace. If ``word_count`` exceeds the number of
    available words, the full text is returned.
    """
    if word_count < 0:
        raise ValueError("word_count must be a non-negative integer")

    text = LOREM_IPSUM_FILE.read_text(encoding="utf-8")
    # Skip markdown header lines (e.g. "# Lorem Ipsum") so they don't
    # consume slots in the requested word count.
    body_lines = [
        line for line in text.splitlines() if not line.lstrip().startswith("#")
    ]
    content = " ".join(body_lines).strip()
    words = content.split()
    return " ".join(words[:word_count])


@mcp.resource("lorem://words/{word_count}")
def lorem_words_resource(word_count: int = DEFAULT_WORD_COUNT) -> str:
    """Resource URI that returns ``word_count`` words from lorem-ipsum.md."""
    return _read_words(word_count)


@mcp.tool
def read(word_count: int = DEFAULT_WORD_COUNT) -> str:
    """Read and return ``word_count`` words from lorem-ipsum.md.

    Args:
        word_count: How many words to return. Defaults to 30.
    """
    return _read_words(word_count)


if __name__ == "__main__":
    mcp.run()
