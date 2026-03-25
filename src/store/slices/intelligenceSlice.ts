//! Intelligence slice — recommendations, descriptions, version chains,
//! query rewriting, and behavior interaction recording.

import { api } from "../../lib/api";
import { reportError } from "../errorStore";
import type {
  AssetDescription,
  BuildFamiliesResult,
  ConfidenceResult,
  DetectVersionsResult,
  QueryRewrite,
  RecommendationResult,
} from "../../types";
import type { AssetStore } from "../assetStore";

export interface IntelligenceSlice {
  // Recommendations
  recommendations: RecommendationResult | null;
  recommendationsLoading: boolean;
  getRecommendations: (assetId: string) => Promise<void>;
  clearRecommendations: () => void;

  // Auto description
  assetDescription: AssetDescription | null;
  descriptionLoading: boolean;
  getDescription: (assetId: string) => Promise<void>;

  // Component families
  componentFamilies: BuildFamiliesResult | null;
  familiesLoading: boolean;
  buildComponentFamilies: () => Promise<void>;

  // Version chains
  versionChains: DetectVersionsResult | null;
  versionChainsLoading: boolean;
  detectVersionChains: () => Promise<void>;

  // Query rewriting
  lastRewrite: QueryRewrite | null;
  rewriteQuery: (query: string) => Promise<QueryRewrite>;

  // Confidence
  lastConfidence: ConfidenceResult | null;

  // Behavior recording
  recordInteraction: (
    query: string,
    assetId: string,
    type: "click" | "favorite" | "copy",
    semanticScore: number,
    sessionKey?: string,
  ) => Promise<void>;
}

export function createIntelligenceSlice(
  set: (fn: (s: AssetStore) => Partial<AssetStore>) => void,
  _get: () => AssetStore,
): IntelligenceSlice {
  return {
    // ── Recommendations ────────────────────────────────────────────────────
    recommendations: null,
    recommendationsLoading: false,

    getRecommendations: async (assetId: string) => {
      set(() => ({ recommendationsLoading: true }));
      try {
        const result = await api.getRecommendations(assetId);
        set(() => ({ recommendations: result, recommendationsLoading: false }));
      } catch (err) {
        set(() => ({ recommendationsLoading: false }));
        reportError(err, "getRecommendations");
      }
    },

    clearRecommendations: () => set(() => ({ recommendations: null })),

    // ── Description ───────────────────────────────────────────────────────
    assetDescription: null,
    descriptionLoading: false,

    getDescription: async (assetId: string) => {
      set(() => ({ descriptionLoading: true }));
      try {
        const result = await api.getOrGenerateDescription(assetId);
        set(() => ({ assetDescription: result, descriptionLoading: false }));
      } catch (err) {
        set(() => ({ descriptionLoading: false }));
        reportError(err, "getDescription");
      }
    },

    // ── Component families ────────────────────────────────────────────────
    componentFamilies: null,
    familiesLoading: false,

    buildComponentFamilies: async () => {
      set(() => ({ familiesLoading: true }));
      try {
        const result = await api.buildComponentFamilies();
        set(() => ({ componentFamilies: result, familiesLoading: false }));
      } catch (err) {
        set(() => ({ familiesLoading: false }));
        reportError(err, "buildComponentFamilies");
      }
    },

    // ── Version chains ────────────────────────────────────────────────────
    versionChains: null,
    versionChainsLoading: false,

    detectVersionChains: async () => {
      set(() => ({ versionChainsLoading: true }));
      try {
        const result = await api.detectVersionChains();
        set(() => ({ versionChains: result, versionChainsLoading: false }));
      } catch (err) {
        set(() => ({ versionChainsLoading: false }));
        reportError(err, "detectVersionChains");
      }
    },

    // ── Query rewriting ───────────────────────────────────────────────────
    lastRewrite: null,

    rewriteQuery: async (query: string): Promise<QueryRewrite> => {
      try {
        const result = await api.rewriteQuery(query);
        set(() => ({ lastRewrite: result }));
        return result;
      } catch {
        return { original: query, rewritten: query, confidence: 0, from_cache: false };
      }
    },

    // ── Confidence ────────────────────────────────────────────────────────
    lastConfidence: null,

    // ── Interaction recording ─────────────────────────────────────────────
    recordInteraction: async (query, assetId, type, semanticScore, sessionKey = "") => {
      try {
        await api.recordSearchInteraction(query, assetId, type, semanticScore, sessionKey);
      } catch {
        // Non-critical — swallow errors silently
      }
    },
  };
}
