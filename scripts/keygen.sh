#!/usr/bin/env bash
# keygen.sh — Generate the Tauri updater signing keypair.
#
# Run this ONCE locally, then add the keys to GitHub Actions secrets.
# Keep the private key (.key) secure — never commit it to version control.
#
# Usage: bash scripts/keygen.sh
#
# Output:
#   ~/.tauri/asset-vault.key      — PRIVATE key  (→ TAURI_SIGNING_PRIVATE_KEY secret)
#   ~/.tauri/asset-vault.key.pub  — PUBLIC key   (→ paste into tauri.conf.json)

set -euo pipefail

KEY_PATH="${HOME}/.tauri/asset-vault.key"

if [[ -f "$KEY_PATH" ]]; then
    echo "Key already exists at $KEY_PATH"
    echo "Delete it first if you want to regenerate:"
    echo "  rm $KEY_PATH ${KEY_PATH}.pub"
    exit 1
fi

mkdir -p "$(dirname "$KEY_PATH")"

echo "==> Generating Tauri updater signing keypair..."
npx tauri signer generate -w "$KEY_PATH"

echo ""
echo "════════════════════════════════════════════════════════"
echo " NEXT STEPS"
echo "════════════════════════════════════════════════════════"
echo ""
echo " 1. Copy public key into tauri.conf.json:"
echo "    Replace the placeholder in plugins.updater.pubkey with:"
echo ""
cat "${KEY_PATH}.pub"
echo ""
echo " 2. Add GitHub Actions secrets:"
echo ""
echo "    TAURI_SIGNING_PRIVATE_KEY"
echo "      Value: contents of $KEY_PATH"
echo "      (run:  cat $KEY_PATH)"
echo ""
echo "    TAURI_SIGNING_PRIVATE_KEY_PASSWORD"
echo "      Value: the passphrase you entered above"
echo "             (leave empty if you chose no passphrase)"
echo ""
echo " 3. (Optional) Windows code-signing secrets for SmartScreen:"
echo "    WINDOWS_CERTIFICATE"
echo "      Value: base64-encoded .pfx file"
echo "      (run:  base64 -i my-cert.pfx | pbcopy   # macOS)"
echo "      (run:  certutil -encode my-cert.pfx cert.b64 && cat cert.b64 | clip   # Windows)"
echo ""
echo "    WINDOWS_CERTIFICATE_PASSWORD"
echo "      Value: the .pfx password"
echo ""
echo " Docs: https://tauri.app/distribute/sign/windows/"
echo "════════════════════════════════════════════════════════"
