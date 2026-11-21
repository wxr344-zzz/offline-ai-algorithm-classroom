/** Browser-safe storage entrypoint: IndexedDB, HTTP, shared types and errors. */
export { BrowserAssetStore, type BrowserAssetStoreOptions } from './asset/browser-store.js';
export type { AssetRef, AssetMeta, BinaryBlob, StorageProvider } from '@openmaic/dsl';
export type { DeviceSafeKVStore, KVScope, KVStore, LocalKVStore } from './kv/types.js';
export { assertKVScope, DEFAULT_KV_SCOPE, KVScopeViolationError } from './kv/types.js';
export { BrowserKVStore, type BrowserKVStoreOptions } from './kv/browser.js';
export {
  HttpAccountKV,
  HttpKVStore,
  HttpKVStoreError,
  type AccountScope,
  type HttpAccountKVOptions,
  type HttpKVHeadersContext,
  type HttpKVHeadersHook,
  type HttpKVStoreOptions,
} from './kv/http.js';
export {
  HttpAssetStore,
  HttpAssetStoreError,
  type HttpAssetHeadersContext,
  type HttpAssetHeadersHook,
  type HttpAssetStoreOptions,
} from './asset/http.js';
export { newAssetId, toAssetId, type AssetId } from './asset/id.js';
export {
  ASSET_DESCRIPTOR_MEDIA_TYPE,
  AssetNotFoundError,
  AssetQuotaExceededError,
  DEFAULT_RENDERABLE_TYPES,
  EXCLUDED_RENDERABLE_TYPES,
  type AssetBytes,
  type AssetIdentity,
  type AssetIndirectRead,
  type AssetIndirectReadRequest,
  type AssetPrincipal,
  type AssetStore,
} from './asset/types.js';
export type { AssetByteStore, AssetSignedReadHeaders } from './asset/byte-store.js';
export {
  kvPersistStorage,
  type PersistedValue,
  type PersistStorageLike,
} from './zustand/persist.js';
export type {
  DocumentStore,
  MaicDocument,
  DocumentSummary,
  DocumentFolder,
  DocumentFolderStore,
  SceneLike,
  SceneValidator,
  StageValidator,
  StageSceneManifest,
  StageFreshnessManifest,
  StageFreshnessManifestStore,
} from './document/types.js';
export { StorageBusyError, isStorageBusyError } from './store-errors.js';
export {
  DocumentFolderLimitError,
  DocumentNotFoundError,
  DocumentVersionError,
  DocumentWriteRefusedError,
  isDocumentWriteRefusedError,
} from './document/types.js';
export { BrowserDocumentStore, type BrowserDocumentStoreOptions } from './document/browser.js';
export {
  HttpDocumentStore,
  HttpDocumentStoreError,
  type HttpDocumentHeadersContext,
  type HttpDocumentHeadersHook,
  type HttpDocumentStoreOptions,
} from './document/http.js';
export type {
  RuntimeStore,
  RuntimeSessionInit,
  RuntimePayloadValidator,
  RuntimeAppendOptions,
  RuntimeTailOptions,
} from './runtime/types.js';
export {
  RuntimeAppendConflictError,
  RuntimeSessionExistsError,
  RuntimeStageNotFoundError,
} from './runtime/types.js';
export { BrowserRuntimeStore, type BrowserRuntimeStoreOptions } from './runtime/browser.js';
export {
  AGENT_SESSION_LIFECYCLE,
  AGENT_SESSION_STATUSES,
  AGENT_SESSION_URL_SOURCES,
  OWNER_SESSION_EVENT_TYPES,
  AgentSessionAccessError,
  AgentSessionEntryTreeError,
  AgentSessionLeaseLostError,
  extractObservedUrls,
  normalizeObservedUrl,
  type AgentSessionClaimReason,
  type AgentSessionAutomaticTitleStore,
  type AgentSessionCompactionEntry,
  type AgentSessionCustomMessageEntry,
  type AgentSessionEntry,
  type AgentSessionEntryBase,
  type AgentSessionEntryTree,
  type AgentSessionEntryTreeHandle,
  type AgentSessionEventLog,
  type AgentSessionHooks,
  type AgentSessionLabelEntry,
  type AgentSessionLeafEntry,
  type AgentSessionLease,
  type AgentSessionLifecycleEventType,
  type AgentSessionMessageEntry,
  type AgentSessionMeta,
  type AgentSessionStatus,
  type AgentSessionStore,
  type AgentSessionTitleStore,
  type AgentSessionTransaction,
  type AgentSessionUrlSource,
  type AgentSessionUrlStore,
  type AgentSessionUserMessage,
  type ClaimedAgentSession,
  type ClaimAgentSessionOptions,
  type CreateAgentSessionInput,
  type FinishAgentSessionPatch,
  type NewAgentSessionEvent,
  type NewOwnerSessionEvent,
  type OwnerSessionEventProjection,
  type OwnerSessionEventType,
  type PersistedAgentSessionEvent,
  type PersistedOwnerSessionEvent,
  type PostAgentUserMessageOptions,
  type PostAgentUserMessageResult,
} from './agent-session/types.js';
export {
  USER_SKILL_EDITABLE_PATHS,
  USER_SKILL_LIMIT,
  USER_SKILL_CONTENT_MAX_BYTES,
  USER_SKILL_NAME_PATTERN,
  UserSkillError,
  applyOpsOnce,
  applyUserSkillPatchOps,
  hasUnpairedSurrogate,
  normalizeUserSkillFields,
  validateUserSkillFields,
  validateUserSkillInput,
  type AppliedUserSkillOp,
  type UserSkillEditablePath,
  type UserSkillErrorCode,
  type UserSkillFields,
  type UserSkillPatchOpInput,
  type UserSkillPatchOutcome,
  type UserSkillRecord,
  type UserSkillStore,
} from './skill/types.js';
export {
  AGENT_SESSION_MATERIAL_KINDS,
  AgentSessionMaterialError,
  createMaterialId,
  isAgentSessionMaterialKind,
  MATERIAL_EXTRACTION_STATUSES,
  MAX_MATERIAL_EXTRACTION_RETRIES,
  type AgentSessionMaterial,
  type AgentSessionMaterialKind,
  type AgentSessionMaterialStore,
  type CreateAgentSessionMaterialInput,
  type ListAgentSessionMaterialsOptions,
  type MaterialExtractionStatus,
  type MaterialExtractionState,
  type MaterialExtractionStats,
  type ClaimedMaterialExtraction,
  type ClaimMaterialExtractionOptions,
  type CompleteMaterialExtractionInput,
  type MaterialExtractionFailureSettlement,
} from './material/types.js';
