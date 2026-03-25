#!/usr/bin/env bash
# build-linux-docker.sh — Build Linux release artifacts (AppImage + .deb) inside
# an Ubuntu 22.04 Docker container to exactly match the CI environment.
#
# Prerequisites:
#   - Docker Desktop (or Colima) running
#   - On Apple Silicon: linux/amd64 emulation is enabled by default
#
# Rust incremental compilation is cached in a named Docker volume
# (assetvault-cargo-target-linux) so subsequent builds are much faster.
#
# Signing key (optional — same as build-local.sh):
#   TAURI_SIGNING_PRIVATE_KEY + TAURI_SIGNING_PRIVATE_KEY_PASSWORD env vars,
#   or key stored at ~/.tauri/asset-vault-v2.key (auto-loaded).
#
# Output: release-artifacts/
#   AssetVault_<version>_amd64.AppImage  (+ .tar.gz.sig if key present)
#   asset-vault_<version>_amd64.deb
#
# Usage:
#   bash scripts/build-linux-docker.sh
#   bash scripts/build-linux-docker.sh --no-cache   # force full rebuild

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

IMAGE="assetvault-linux-builder"
CARGO_VOLUME="assetvault-cargo-target-linux"  # persists Rust incremental cache
DOCKER_BUILD_FLAGS=""

for arg in "$@"; do
    [[ "$arg" == "--no-cache" ]] && DOCKER_BUILD_FLAGS="--no-cache"
done

# ── Load signing key from file if not in environment ─────────────────────────
KEY_FILE="$HOME/.tauri/asset-vault-v2.key"
if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" && -f "$KEY_FILE" ]]; then
    export TAURI_SIGNING_PRIVATE_KEY
    TAURI_SIGNING_PRIVATE_KEY=$(cat "$KEY_FILE")
    echo "==> Loaded signing key from $KEY_FILE"
fi

# ── Build/update the toolchain image ─────────────────────────────────────────
# Only rebuilds when Dockerfile.linux changes (Docker layer cache handles the rest).
echo "==> Building Linux toolchain image (uses Docker layer cache)..."
docker build \
    --platform linux/amd64 \
    --tag "$IMAGE" \
    --file scripts/Dockerfile.linux \
    $DOCKER_BUILD_FLAGS \
    scripts/

# ── Create persistent cargo target volume (no-op if already exists) ───────────
docker volume create "$CARGO_VOLUME" > /dev/null 2>&1 || true

# ── Run the build inside the container ───────────────────────────────────────
echo "==> Running Linux build inside Docker..."
mkdir -p release-artifacts

docker run --rm \
    --platform linux/amd64 \
    --volume "$REPO_ROOT:/workspace" \
    --volume "$CARGO_VOLUME:/workspace/src-tauri/target" \
    --workdir /workspace \
    --env TAURI_SIGNING_PRIVATE_KEY="${TAURI_SIGNING_PRIVATE_KEY:-}" \
    --env TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" \
    "$IMAGE" \
    bash -euo pipefail -c '
        echo "==> Installing Node dependencies..."
        npm ci --silent

        echo "==> Installing Python dependencies..."
        python3 -m pip install --quiet --no-cache-dir \
            -r python-service/requirements.txt pyinstaller

        echo "==> Building Python sidecar..."
        bash scripts/build-sidecar.sh

        echo "==> Running Tauri build (x86_64-unknown-linux-gnu)..."
        npm run tauri build -- \
            --target x86_64-unknown-linux-gnu \
            --config src-tauri/tauri.release.conf.json

        echo "==> Copying artifacts to release-artifacts/..."
        find src-tauri/target/x86_64-unknown-linux-gnu/release/bundle \
            \( \
                -name "*.AppImage"         \
                -o -name "*.AppImage.tar.gz"     \
                -o -name "*.AppImage.tar.gz.sig" \
                -o -name "*.deb"                 \
            \) \
            -exec cp -v {} /workspace/release-artifacts/ \;
    '

echo ""
echo "==> Done! Linux artifacts:"
ls -lh release-artifacts/ 2>/dev/null || echo "   (none found)"
echo ""
echo "   Next: bash scripts/upload-release.sh [--publish]"
