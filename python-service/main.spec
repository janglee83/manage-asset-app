# main.spec — PyInstaller build spec for the AssetVault Python sidecar.
#
# Build:  pyinstaller --noconfirm python-service/main.spec
#         OR run: scripts/build-sidecar.ps1 (Windows) / scripts/build-sidecar.sh (macOS/Linux)
#
# Output: python-service/dist/asset-vault-sidecar/
#   asset-vault-sidecar[.exe]  — entry-point executable
#   _internal/                 — bundled Python runtime + libraries
#
# The Tauri app's lib.rs production path finds this at:
#   resource_dir/resources/asset-vault-sidecar/asset-vault-sidecar.exe

import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_all, collect_data_files

HERE = Path(SPECPATH)  # python-service/

# ── Collect all sub-packages that PyInstaller misses with static analysis ────

datas, binaries, hiddenimports = [], [], []

for pkg in [
    "sentence_transformers",
    "transformers",
    "tokenizers",
    "huggingface_hub",
    "safetensors",
    "PIL",
]:
    d, b, h = collect_all(pkg)
    datas    += d
    binaries  += b
    hiddenimports += h

# Torch — collect all to pull in DLLs, CUDA stubs, etc.
td, tb, th = collect_all("torch")
datas    += td
binaries  += tb
hiddenimports += th

# FAISS
fd, fb, fh = collect_all("faiss")
datas    += fd
binaries  += fb
hiddenimports += fh

# NumPy
nd, nb, nh = collect_all("numpy")
datas    += nd
binaries  += nb
hiddenimports += nh

# ── Analysis ──────────────────────────────────────────────────────────────────

a = Analysis(
    [str(HERE / "main.py")],
    pathex=[str(HERE)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports + [
        "PIL._tkinter_finder",
        "pkg_resources.py2_warn",
        "packaging.version",
        "packaging.specifiers",
        "packaging.requirements",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # GUI frameworks not needed
        "tkinter",
        "matplotlib",
        "IPython",
        "notebook",
        "jupyter",
        "scipy",
        "sklearn",
        "cv2",
        # Torch training / GPU stubs we don't need for inference-only
        "torch.distributed",
        "torch.testing",
        "torchvision.datasets",
        "torchvision.transforms.functional_pil",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,      # --onedir: binaries stay in the output directory
    name="asset-vault-sidecar",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,                   # compress executables; set to False if UPX is unavailable
    console=True,               # must be True: communicates via stdin/stdout
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="asset-vault-sidecar",  # → dist/asset-vault-sidecar/
)
