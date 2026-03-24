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

echo "Installing dependencies (this may take a while - downloading CLIP + PyTorch)..."
pip install -r "$SCRIPT_DIR/requirements.txt"

echo ""
echo "Setup complete!"
echo "Python sidecar is ready at: $VENV_DIR/bin/python $SCRIPT_DIR/main.py"
