#!/usr/bin/env bash
# upload-release.sh — Upload locally-built artifacts to a GitHub Release.
#
# Prerequisites:
#   - gh CLI installed and authenticated
#     brew install gh && gh auth login
#   - Artifacts in release-artifacts/  (built by build-local.sh / build-linux-docker.sh)
#
# The script creates a draft release if one doesn't exist yet.
# Pass --publish to also flip it from draft → public once all uploads finish.
#
# Usage:
#   bash scripts/upload-release.sh             # upload, keep as draft
#   bash scripts/upload-release.sh --publish   # upload then publish

set -euo pipefail

REPO="janglee83/manage-asset-app"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

PUBLISH=false
for arg in "$@"; do
    [[ "$arg" == "--publish" ]] && PUBLISH=true
done

# ── Preflight: gh CLI ─────────────────────────────────────────────────────────
if ! command -v gh &>/dev/null; then
    echo "ERROR: gh CLI not found."
    echo "       Install: brew install gh"
    echo "       Then:    gh auth login"
    exit 1
fi

# ── Read version from tauri.conf.json ─────────────────────────────────────────
VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
TAG="v$VERSION"
echo "==> Release tag: $TAG"

# ── Collect artifacts ─────────────────────────────────────────────────────────
shopt -s nullglob
ARTIFACTS=(
    release-artifacts/*.dmg
    release-artifacts/*.exe
    release-artifacts/*.msi
    release-artifacts/*.AppImage
    release-artifacts/*.deb
    release-artifacts/*.tar.gz
    release-artifacts/*.sig
)

if [[ ${#ARTIFACTS[@]} -eq 0 ]]; then
    echo "ERROR: No artifacts found in release-artifacts/"
    echo "       Run build-local.sh and/or build-linux-docker.sh first."
    exit 1
fi

echo "==> Found ${#ARTIFACTS[@]} artifact(s):"
for f in "${ARTIFACTS[@]}"; do
    printf "      %s  (%s)\n" "$(basename "$f")" "$(du -sh "$f" | cut -f1)"
done

# ── Create release if it doesn't exist yet ────────────────────────────────────
if ! gh release view "$TAG" --repo "$REPO" &>/dev/null; then
    echo "==> Creating draft release $TAG..."
    gh release create "$TAG" \
        --repo "$REPO" \
        --title "AssetVault $TAG" \
        --draft \
        --generate-notes
else
    echo "==> Release $TAG already exists — uploading artifacts..."
fi

# ── Upload (--clobber replaces files with the same name) ─────────────────────
echo "==> Uploading artifacts..."
gh release upload "$TAG" "${ARTIFACTS[@]}" \
    --repo "$REPO" \
    --clobber

# ── Optionally publish ────────────────────────────────────────────────────────
if $PUBLISH; then
    echo "==> Publishing release (draft → public)..."
    gh release edit "$TAG" \
        --repo "$REPO" \
        --draft=false \
        --latest
    echo "==> Published: https://github.com/$REPO/releases/tag/$TAG"
else
    echo "==> Release is still a draft."
    echo "    To publish: bash scripts/upload-release.sh --publish"
    echo "    Or manually: https://github.com/$REPO/releases/tag/$TAG"
fi
