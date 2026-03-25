#!/usr/bin/env bash
# build-sidecar.sh — Compile the Python semantic-search service into a
# self-contained binary using PyInstaller (--onedir mode).
#
# For macOS/Linux development or CI.  The Windows equivalent is
# scripts/build-sidecar.ps1.
#
# Output: src-tauri/resources/asset-vault-sidecar/
#   asset-vault-sidecar       ← entry-point
#   _internal/                ← bundled libraries
#
# Usage: bash scripts/build-sidecar.sh
# Requirements: Python 3.11+, pip in PATH.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_DIR="$REPO_ROOT/python-service"
OUT_DIR="$REPO_ROOT/src-tauri/resources/asset-vault-sidecar"
SPEC_FILE="$SERVICE_DIR/main.spec"

echo "==> Installing Python service dependencies..."
(cd "$SERVICE_DIR" && python3 -m pip install --quiet --upgrade pip)
(cd "$SERVICE_DIR" && python3 -m pip install --quiet -r requirements.txt)
(cd "$SERVICE_DIR" && python3 -m pip install --quiet pyinstaller)

echo "==> Running PyInstaller (--onedir)..."
if [[ -f "$SPEC_FILE" ]]; then
    pyinstaller \
        --distpath "$SERVICE_DIR/dist" \
        --workpath "$SERVICE_DIR/build" \
        --noconfirm \
        "$SPEC_FILE"
else
    pyinstaller \
        --name asset-vault-sidecar \
        --onedir \
        --noconfirm \
        --distpath "$SERVICE_DIR/dist" \
        --workpath "$SERVICE_DIR/build" \
        --collect-all sentence_transformers \
        --collect-all transformers \
        --collect-all faiss \
        "$SERVICE_DIR/main.py"
fi

PY_SIDECAR_SRC="$SERVICE_DIR/dist/asset-vault-sidecar"

if [[ ! -d "$PY_SIDECAR_SRC" ]]; then
    echo "ERROR: PyInstaller output not found at: $PY_SIDECAR_SRC" >&2
    exit 1
fi

echo "==> Copying sidecar to src-tauri/resources/..."
rm -rf "$OUT_DIR"
cp -r "$PY_SIDECAR_SRC" "$OUT_DIR"

echo ""
echo "==> Sidecar built successfully:"
echo "    $OUT_DIR/asset-vault-sidecar"
echo ""
echo "    Run 'npm run tauri build' to package it into the app bundle."
