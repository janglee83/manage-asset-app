#!/usr/bin/env bash
# build-local.sh — Build macOS release artifacts locally (arm64 + x64 DMG).
#
# Prerequisites:
#   macOS, Xcode Command Line Tools, Python 3.11+
#   Rust targets: aarch64-apple-darwin, x86_64-apple-darwin
#     → auto-installed by this script via rustup
#
# Signing key (needed for updater signatures — optional for plain DMG):
#   Option A: TAURI_SIGNING_PRIVATE_KEY env var (base64 key content)
#             + TAURI_SIGNING_PRIVATE_KEY_PASSWORD env var
#   Option B: key stored at ~/.tauri/asset-vault-v2.key (auto-loaded)
#   Option C: skip signing — installer still works, just no auto-update sigs
#
# Output: release-artifacts/
#   AssetVault_<version>_aarch64.dmg
#   AssetVault_<version>_x64.dmg
#   AssetVault_<arch>.app.tar.gz + .sig  (updater bundles, if key present)
#
# Usage:
#   bash scripts/build-local.sh              # both arm64 + x64
#   bash scripts/build-local.sh --arm64-only # Apple Silicon only (faster)
#   bash scripts/build-local.sh --x64-only   # Intel only

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ── Argument parsing ──────────────────────────────────────────────────────────
BUILD_ARM64=true
BUILD_X64=true
for arg in "$@"; do
    case "$arg" in
        --arm64-only) BUILD_X64=false ;;
        --x64-only)   BUILD_ARM64=false ;;
    esac
done

# ── Platform check ────────────────────────────────────────────────────────────
if [[ "$(uname)" != "Darwin" ]]; then
    echo "ERROR: build-local.sh must run on macOS. For Linux, use build-linux-docker.sh" >&2
    exit 1
fi

# ── Load signing key from file if not in environment ─────────────────────────
KEY_FILE="$HOME/.tauri/asset-vault-v2.key"
if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" && -f "$KEY_FILE" ]]; then
    export TAURI_SIGNING_PRIVATE_KEY
    TAURI_SIGNING_PRIVATE_KEY=$(cat "$KEY_FILE")
    echo "==> Loaded signing key from $KEY_FILE"
fi

if [[ -n "${TAURI_SIGNING_PRIVATE_KEY:-}" && -z "${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}" ]]; then
    if [[ -t 0 ]]; then
        read -r -s -p "==> Enter signing key password (press Enter to skip signing): " TAURI_SIGNING_PRIVATE_KEY_PASSWORD
        echo
        export TAURI_SIGNING_PRIVATE_KEY_PASSWORD
    fi
fi

if [[ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]]; then
    echo "    WARNING: No signing key found — updater signatures will be skipped."
fi

# ── Ensure Rust targets ───────────────────────────────────────────────────────
echo "==> Checking Rust targets..."
$BUILD_ARM64 && rustup target add aarch64-apple-darwin 2>/dev/null || true
$BUILD_X64   && rustup target add x86_64-apple-darwin  2>/dev/null || true

# ── Node dependencies ─────────────────────────────────────────────────────────
echo "==> Installing Node dependencies..."
npm ci --silent

# ── Python sidecar ────────────────────────────────────────────────────────────
echo "==> Building Python sidecar..."
bash scripts/build-sidecar.sh

# ── Tauri builds ─────────────────────────────────────────────────────────────
mkdir -p release-artifacts

TAURI_ARGS="--config src-tauri/tauri.release.conf.json"

if $BUILD_ARM64; then
    echo "==> Building macOS Apple Silicon (aarch64-apple-darwin)..."
    npm run tauri build -- --target aarch64-apple-darwin $TAURI_ARGS
fi

if $BUILD_X64; then
    echo "==> Building macOS Intel (x86_64-apple-darwin)..."
    npm run tauri build -- --target x86_64-apple-darwin $TAURI_ARGS
fi

# ── Collect artifacts ─────────────────────────────────────────────────────────
echo "==> Collecting artifacts into release-artifacts/..."
# DMG installers
find src-tauri/target -path "*/bundle/dmg/*.dmg" \
    -newer src-tauri/Cargo.toml -exec cp -v {} release-artifacts/ \;
# Updater bundles (.app.tar.gz + .sig)
find src-tauri/target -path "*/bundle/macos/*.tar.gz" \
    -newer src-tauri/Cargo.toml -exec cp -v {} release-artifacts/ \;
find src-tauri/target -path "*/bundle/macos/*.tar.gz.sig" \
    -newer src-tauri/Cargo.toml -exec cp -v {} release-artifacts/ \;

echo ""
echo "==> Done! macOS artifacts:"
ls -lh release-artifacts/ 2>/dev/null || echo "   (none found)"
echo ""
echo "   Next: bash scripts/upload-release.sh [--publish]"
