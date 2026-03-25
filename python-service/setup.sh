#!/usr/bin/env bash
# Setup script for the Python sidecar service
# Run this once before first use

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/.venv"

echo "Creating Python virtual environment..."
python3 -m venv "$VENV_DIR"

echo "Activating virtual environment..."
source "$VENV_DIR/bin/activate"

echo "Upgrading pip..."
pip install --upgrade pip

echo "Installing dependencies..."
echo "  This downloads PyTorch + sentence-transformers + FAISS (~1-2 GB on first run)."
pip install -r "$SCRIPT_DIR/requirements.txt"

echo ""
echo "Setup complete!"
echo "Python sidecar: $VENV_DIR/bin/python $SCRIPT_DIR/main.py"
echo ""
echo "NOTE: On first launch the app will download two model checkpoints (~440 MB)"
echo "  clip-ViT-B-32                        (CLIP image encoder)"
echo "  clip-ViT-B-32-multilingual-v1        (multilingual text encoder, EN/JA/VI/...)"
echo "They are cached in ~/.cache/huggingface/hub/ and never re-downloaded."
