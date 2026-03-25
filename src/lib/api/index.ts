//! Merged API object — re-exports all domain sub-modules as a single `api` value.
//!
//! Usage (unchanged from the old api.ts):
//!   import { api } from "../lib/api";

import { assetsApi }    from "./assets";
import { searchApi }    from "./search";
import { semanticApi }  from "./semantic";
import { duplicatesApi } from "./duplicates";
import { tagsApi }      from "./tags";
import { recoveryApi }  from "./recovery";
import { exportApi }    from "./export";
import { folderIntelApi } from "./folderIntel";
import { sidecarApi }   from "./sidecar";
import { relationsApi } from "./relations";
import { ocrApi }       from "./ocr";
import { designApi }    from "./design";
import { figApi }       from "./fig";
import { intelligenceApi } from "./intelligence";

export const api = {
  ...assetsApi,
  ...searchApi,
  ...semanticApi,
  ...duplicatesApi,
  ...tagsApi,
  ...recoveryApi,
  ...exportApi,
  ...folderIntelApi,
  ...sidecarApi,
  ...relationsApi,
  ...ocrApi,
  ...designApi,
  ...figApi,
  ...intelligenceApi,
};
