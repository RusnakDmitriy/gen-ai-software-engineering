#!/usr/bin/env bash
# Wrapper for the 5-agent pipeline (homework-4).
set -euo pipefail
cd "$(dirname "$0")"
exec npm run pipeline -- "$@"
