# build-sidecar.ps1 — Compile the Python semantic-search service into a
# self-contained Windows binary using PyInstaller (--onedir mode).
#
# Output: src-tauri/resources/asset-vault-sidecar/
#   asset-vault-sidecar.exe   ← entry-point (launched by lib.rs in production)
#   _internal/                ← all bundled Python libraries + FAISS DLLs
#
# Run locally:   .\scripts\build-sidecar.ps1
# Run in CI:     called automatically by .github/workflows/release.yml
#
# Requirements: Python 3.11 in PATH, pip available.

$ErrorActionPreference = "Stop"

$RepoRoot  = Split-Path -Parent $PSScriptRoot
$ServiceDir = Join-Path $RepoRoot "python-service"
$OutDir     = Join-Path $RepoRoot "src-tauri" "resources" "asset-vault-sidecar"
$SpecFile   = Join-Path $ServiceDir "main.spec"

Write-Host "==> Installing Python service dependencies..." -ForegroundColor Cyan
Push-Location $ServiceDir
python -m pip install --quiet --upgrade pip
python -m pip install --quiet -r requirements.txt
python -m pip install --quiet pyinstaller
Pop-Location

Write-Host "==> Running PyInstaller (--onedir)..." -ForegroundColor Cyan
# Use the .spec file if present for reproducible builds;
# fall back to a generated command if not.
if (Test-Path $SpecFile) {
    pyinstaller --distpath (Join-Path $RepoRoot "python-service" "dist") `
                --workpath (Join-Path $RepoRoot "python-service" "build") `
                --noconfirm `
                $SpecFile
} else {
    pyinstaller `
        --name asset-vault-sidecar `
        --onedir `
        --noconfirm `
        --distpath (Join-Path $RepoRoot "python-service" "dist") `
        --workpath (Join-Path $RepoRoot "python-service" "build") `
        --hidden-import=PIL._tkinter_finder `
        --collect-all=sentence_transformers `
        --collect-all=transformers `
        --collect-all=faiss `
        (Join-Path $ServiceDir "main.py")
}

$PySidecarSrc = Join-Path $RepoRoot "python-service" "dist" "asset-vault-sidecar"

if (-Not (Test-Path $PySidecarSrc)) {
    Write-Error "PyInstaller output not found at: $PySidecarSrc"
    exit 1
}

Write-Host "==> Copying sidecar to src-tauri/resources/..." -ForegroundColor Cyan
if (Test-Path $OutDir) { Remove-Item -Recurse -Force $OutDir }
Copy-Item -Recurse $PySidecarSrc $OutDir

Write-Host ""
Write-Host "==> Sidecar built successfully:" -ForegroundColor Green
Write-Host "    $OutDir\asset-vault-sidecar.exe"
Write-Host ""
Write-Host "    Run 'npm run tauri build' to package it into the installer."
