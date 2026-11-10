/** Opaque identifiers are not user-facing labels. */
export type OpaqueId = string;
export type ISODateTime = string;
export type Base64Url = string;

export interface Account {
  id: OpaqueId;
  email: string;
  status: "active" | "suspended";
  createdAt: ISODateTime;
}

export interface AccountSession {
  account: Account;
  device?: Device;
  expiresAt: ISODateTime;
  authenticatedAt: ISODateTime;
}

export interface AccountRegistrationRequest {
  email: string;
  deviceLabel: string;
  platform: string;
  browser: string;
  publicKeyAlgorithm: string;
  publicKey: Base64Url;
  credentialType: "webauthn" | "external";
  credentialId: string;
  credentialPublicKey?: Base64Url;
  externalSubject?: string;
}

export interface AccountLoginRequest {
  email: string;
  deviceId: OpaqueId;
  credentialType: "webauthn" | "external";
  credentialId: string;
  clientDataJson?: Base64Url;
  authenticatorData?: Base64Url;
  signature?: Base64Url;
}

export interface Device {
  id: OpaqueId;
  label: string;
  platform: string;
  browser: string;
  status: "pending" | "active" | "revoked";
  createdAt: ISODateTime;
  lastSeenAt?: ISODateTime;
  revokedAt?: ISODateTime;
}

export interface DeviceEnrollment {
  id: OpaqueId;
  deviceId: OpaqueId;
  challenge: Base64Url;
  expiresAt: ISODateTime;
  status: "pending" | "approved" | "rejected" | "expired";
}

export interface VaultMetadata {
  id: OpaqueId;
  protocolVersion: number;
  status: "active" | "deleted";
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** Envelope metadata only; the unlock secret and plaintext VEK never belong here. */
export interface VaultKeyEnvelope {
  envelopeType: "password" | "recovery";
  protocolVersion: number;
  keyWrapAlgorithm: string;
  kdfAlgorithm: string;
  kdfParameters: Record<string, number>;
  salt: Base64Url;
  wrappedVek: Base64Url;
}

export interface CreateVaultRequest {
  protocolVersion: number;
  envelopes: [VaultKeyEnvelope, VaultKeyEnvelope];
}

/** Server-transportable encrypted object. Private record fields are not represented. */
export interface EncryptedObjectEnvelope {
  protocolVersion: number;
  algorithm: string;
  keyWrapAlgorithm: string;
  vaultId: OpaqueId;
  objectId: OpaqueId;
  revision: number;
  payloadVersion: number;
  purpose: string;
  nonce: Base64Url;
  wrappedDek: Base64Url;
  ciphertext: Base64Url;
}

export type SyncOperationKind = "upsert" | "delete";

export type SyncOperation =
  | {
      operationId: OpaqueId;
      objectId: OpaqueId;
      kind: "upsert";
      baseRevision: number;
      envelope: EncryptedObjectEnvelope;
      clientCreatedAt: ISODateTime;
    }
  | {
      operationId: OpaqueId;
      objectId: OpaqueId;
      kind: "delete";
      baseRevision: number;
      clientCreatedAt: ISODateTime;
    };

export interface SyncCursor {
  afterSequence: string;
}

export interface RevisionConflict {
  objectId: OpaqueId;
  attemptedBaseRevision: number;
  currentRevision: number;
}

export interface BackupManifest {
  formatVersion: number;
  vaultId: OpaqueId;
  snapshotId: OpaqueId;
  createdAt: ISODateTime;
  encryptedObjectCount: number;
  ciphertextDigest: Base64Url;
}

export interface AttachmentMetadata {
  id: OpaqueId;
  vaultId: OpaqueId;
  ciphertextSize: number;
  ciphertextDigest: Base64Url;
  createdAt: ISODateTime;
}

export interface AttachmentList {
  items: AttachmentMetadata[];
}

export interface AttachmentUploadSessionRequest {
  ciphertextSize: number;
  ciphertextDigest: Base64Url;
}

export interface AttachmentUploadSessionResponse {
  attachmentId: OpaqueId;
  uploadUrl: string;
  objectKey: string;
  expiresAt: ISODateTime;
  maxCiphertextSize: number;
}

export interface AttachmentCompleteRequest {
  ciphertextSize: number;
  ciphertextDigest: Base64Url;
}

export interface AttachmentDownloadSessionResponse {
  downloadUrl: string;
  ciphertextSize: number;
  ciphertextDigest: Base64Url;
  expiresAt: ISODateTime;
}

export interface BackupMetadata {
  snapshotId: OpaqueId;
  vaultId: OpaqueId;
  ciphertextSize: number;
  ciphertextDigest: Base64Url;
  createdAt: ISODateTime;
}

export interface ApiProblem {
  error: {
    code: string;
    message: string;
    requestId: OpaqueId;
    details?: {
      currentRevision?: number;
      attemptedBaseRevision?: number;
    };
  };
}

/** Client-only decrypted record models. Never serialize these into API requests. */
export type DecryptedRecord =
  | PasswordRecord
  | SecureNoteRecord
  | IdentityRecord
  | DocumentRecord
  | PaymentRecord;

interface RecordBase {
  id: OpaqueId;
  title: string;
  tags: string[];
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

export interface PasswordRecord extends RecordBase {
  type: "password";
  url?: string;
  username?: string;
  password: string;
  notes?: string;
}

export interface SecureNoteRecord extends RecordBase {
  type: "secure-note";
  content: string;
}

export interface IdentityRecord extends RecordBase {
  type: "identity";
  fields: Record<string, string | number | boolean | null>;
}

export interface DocumentRecord extends RecordBase {
  type: "document";
  attachmentIds: OpaqueId[];
}

export interface PaymentRecord extends RecordBase {
  type: "payment";
  fields: Record<string, string | number | boolean | null>;
}

export interface CmsModule {
  id: OpaqueId;
  moduleKey: string;
  displayName: string;
  description: string | null;
  iconKey: string;
  isEnabled: boolean;
  displayOrder: number;
  routeKey: string;
}

export interface CmsSection {
  id: OpaqueId;
  screenKey: string;
  sectionType: string;
  title: string;
  contentPayload: Record<string, unknown>;
  styleConfig: Record<string, unknown>;
  displayOrder: number;
  isEnabled: boolean;
}

export interface CmsNavigationItem {
  id: OpaqueId;
  label: string;
  routeKey: string;
  iconKey: string;
  displayOrder: number;
  isEnabled: boolean;
}

export interface CmsThemeSettings {
  themePreset: string;
  primaryColor: string;
  borderRadius: string;
  density: string;
}

export interface CmsRevision {
  id: OpaqueId;
  revisionNumber: number;
  actorDeviceId: string | null;
  changeSummary: string;
  createdAt: ISODateTime;
}

export interface AppConfiguration {
  modules: CmsModule[];
  navigation: CmsNavigationItem[];
  sections: CmsSection[];
  theme: CmsThemeSettings;
  revisionNumber: number;
}
