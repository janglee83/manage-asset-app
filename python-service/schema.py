"""
Index metadata schema — persisted as a JSON sidecar file alongside
the FAISS binary.

Design
------
* SCHEMA_VERSION is bumped whenever the embedding models or index format change.
  On load, if schema_version != SCHEMA_VERSION the caller triggers a full
  re-index to ensure all vectors are in the same embedding space.

* Bidirectional ID maps:
    uuid_to_fid : asset UUID (str)  → FAISS vector ID (int64)
    fid_to_uuid : FAISS vector ID   → asset UUID

  FAISS vector IDs are monotonically increasing ints assigned via alloc_fid().
  They are never reused after release_fid() — gaps are acceptable.
"""

from __future__ import annotations

import json
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Dict, Optional

# ---------------------------------------------------------------------------
# Bump this constant whenever models or index layout change.
# The sidecar will detect the mismatch at startup and request a re-index.
# ---------------------------------------------------------------------------
SCHEMA_VERSION = 2

# Embedding vector dimension — must match the CLIP model output.
# Changing this requires bumping SCHEMA_VERSION and rebuilding the index.
EMBED_DIM = 512


@dataclass
class AssetMeta:
    """
    Lightweight per-asset metadata stored alongside the FAISS index.

    Used by the multi-signal ranker to compute keyword, recency, and
    folder-priority signals without a round-trip to the SQLite database.
    All fields are derived automatically from the ``file_path`` passed
    during embedding.
    """

    filename:    str   = ""    # e.g. "brand-logo_v2.png"
    folder_path: str   = ""    # e.g. "/Users/alice/Design/brand"
    modified_at: float = 0.0   # Unix timestamp (seconds); 0 = unknown


@dataclass
class IndexMeta:
    schema_version: int = SCHEMA_VERSION

    # Model identifiers recorded at creation time; used for staleness detection.
    image_model: str = "clip-ViT-B-32"
    text_model: str = "sentence-transformers/clip-ViT-B-32-multilingual-v1"

    dimension: int = 512
    index_type: str = "flat"        # "flat" | "ivf" (reserved for future use)

    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    total: int = 0                  # mirrors index.ntotal for quick reads

    # ── ID maps ───────────────────────────────────────────────────────────────
    uuid_to_fid: Dict[str, int] = field(default_factory=dict)
    fid_to_uuid: Dict[int, str] = field(default_factory=dict)
    next_fid: int = 0               # next unallocated FAISS ID

    # ── Persistence ───────────────────────────────────────────────────────────

    @classmethod
    def load(cls, path: Path) -> "IndexMeta":
        """Load from JSON; returns a fresh default instance on any error."""
        if not path.exists():
            return cls()
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
            # JSON only has string keys; restore int keys for fid_to_uuid.
            raw["fid_to_uuid"] = {
                int(k): v for k, v in raw.get("fid_to_uuid", {}).items()
            }
            raw["uuid_to_fid"] = {
                k: int(v) for k, v in raw.get("uuid_to_fid", {}).items()
            }
            known = cls.__dataclass_fields__.keys()
            return cls(**{k: v for k, v in raw.items() if k in known})
        except Exception:
            return cls()

    def save(self, path: Path) -> None:
        self.updated_at = time.time()
        path.write_text(json.dumps(asdict(self), indent=2), encoding="utf-8")

    # ── Schema validation ─────────────────────────────────────────────────────

    def needs_reindex(self) -> bool:
        """True when the persisted schema is incompatible with the current code."""
        return self.schema_version != SCHEMA_VERSION

    # ── ID allocation ─────────────────────────────────────────────────────────

    def alloc_fid(self, asset_uuid: str) -> int:
        """
        Return the FAISS ID for asset_uuid, allocating a new one if needed.
        Idempotent: calling twice for the same UUID returns the same ID.
        """
        if asset_uuid in self.uuid_to_fid:
            return self.uuid_to_fid[asset_uuid]
        fid: int = self.next_fid
        self.next_fid += 1
        self.uuid_to_fid[asset_uuid] = fid
        self.fid_to_uuid[fid] = asset_uuid
        return fid

    def release_fid(self, asset_uuid: str) -> Optional[int]:
        """
        Remove the ID mapping for asset_uuid.
        Returns the released FAISS ID, or None if the asset was not in the index.
        """
        fid = self.uuid_to_fid.pop(asset_uuid, None)
        if fid is not None:
            self.fid_to_uuid.pop(fid, None)
        return fid

    def has_asset(self, asset_uuid: str) -> bool:
        return asset_uuid in self.uuid_to_fid
