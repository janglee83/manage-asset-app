import { invoke } from "@tauri-apps/api/core";
import type { AssetRelation, RelationGroup, RelationGraphStats } from "../../types";

export const relationsApi = {
  getAssetRelations: (assetId: string): Promise<AssetRelation[]> =>
    invoke("get_asset_relations", { assetId }),

  getRelationGroups: (assetId: string): Promise<RelationGroup[]> =>
    invoke("get_relation_groups", { assetId }),

  rebuildRelationGraph: (): Promise<RelationGraphStats> =>
    invoke("rebuild_relation_graph"),
};
