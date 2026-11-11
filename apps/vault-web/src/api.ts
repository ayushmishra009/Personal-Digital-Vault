import type {
  AppConfiguration,
  SyncOperation,
  EncryptedObjectEnvelope,
  AttachmentMetadata,
  AttachmentList,
  AttachmentUploadSessionRequest,
  AttachmentUploadSessionResponse,
  AttachmentCompleteRequest,
  AttachmentDownloadSessionResponse,
} from "@pdv/data-models";

export type {
  AppConfiguration,
  SyncOperation,
  EncryptedObjectEnvelope,
  AttachmentMetadata,
  AttachmentList,
  AttachmentUploadSessionRequest,
  AttachmentUploadSessionResponse,
  AttachmentCompleteRequest,
  AttachmentDownloadSessionResponse,
};

export interface Account {
  id: string;
  email: string;
  status: "active" | "suspended";
  createdAt: string;
}

export interface Device {
  id: string;
  label: string;
  platform: string;
  browser: string;
  status: "pending" | "active" | "revoked";
  createdAt: string;
  lastSeenAt?: string;
  revokedAt?: string;
}

export interface AccountSession {
  account: Account;
  device?: Device;
  authenticatedAt: string;
  expiresAt: string;
}

export interface DeviceEnrollment {
  id: string;
  deviceId: string;
  challenge: string;
  expiresAt: string;
  status: "pending" | "approved" | "rejected" | "expired";
}

export interface Problem {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
    details?: {
      currentRevision?: number;
      attemptedBaseRevision?: number;
    };
  };
}

export class ConflictError extends Error {
  status = 409;
  objectId?: string;
  currentRevision?: number;
  attemptedBaseRevision?: number;

  constructor(
    message: string,
    details?: {
      currentRevision?: number;
      attemptedBaseRevision?: number;
      objectId?: string;
    },
  ) {
    super(message);
    this.name = "ConflictError";
    this.currentRevision = details?.currentRevision;
    this.attemptedBaseRevision = details?.attemptedBaseRevision;
    this.objectId = details?.objectId;
  }
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let errMessage = `HTTP ${res.status}`;
    let probDetails:
      { currentRevision?: number; attemptedBaseRevision?: number } | undefined;
    try {
      const prob: Problem = await res.json();
      errMessage =
        prob.detail || prob.title || prob.error?.message || errMessage;
      if (prob.error?.details) {
        probDetails = prob.error.details;
      }
    } catch {
      // fallback
    }
    if (res.status === 409) {
      throw new ConflictError(errMessage, probDetails);
    }
    throw new Error(errMessage);
  }
  if (res.status === 204) {
    return undefined as unknown as T;
  }
  return res.json() as Promise<T>;
}

export async function getSession(): Promise<AccountSession | null> {
  const res = await fetch("/api/v1/auth/session", {
    credentials: "include",
  });
  if (res.status === 401 || res.status === 403) {
    return null;
  }
  return handleResponse<AccountSession>(res);
}

export async function registerAccount(params: {
  email: string;
  deviceLabel: string;
  platform: string;
  browser: string;
  publicKeyAlgorithm: string;
  publicKey: string;
  credentialType: "webauthn" | "external";
  credentialId: string;
  credentialPublicKey?: string;
  externalSubject?: string;
}): Promise<AccountSession> {
  const res = await fetch("/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(params),
  });
  return handleResponse<AccountSession>(res);
}

export async function loginAccount(params: {
  email: string;
  deviceId: string;
  credentialType: "webauthn" | "external";
  credentialId: string;
}): Promise<AccountSession> {
  const res = await fetch("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(params),
  });
  return handleResponse<AccountSession>(res);
}

export async function logoutAccount(): Promise<void> {
  const res = await fetch("/api/v1/auth/logout", {
    method: "POST",
    credentials: "include",
  });
  return handleResponse<void>(res);
}

export async function listDevices(): Promise<{ items: Device[] }> {
  const res = await fetch("/api/v1/devices", {
    credentials: "include",
  });
  return handleResponse<{ items: Device[] }>(res);
}

export async function createDeviceEnrollment(params: {
  deviceLabel: string;
  platform: string;
  browser: string;
  publicKeyAlgorithm: string;
  publicKey: string;
}): Promise<DeviceEnrollment> {
  const res = await fetch("/api/v1/device-enrollments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(params),
  });
  return handleResponse<DeviceEnrollment>(res);
}

export async function getDeviceEnrollment(
  enrollmentId: string,
): Promise<DeviceEnrollment> {
  const res = await fetch(
    `/api/v1/device-enrollments/${encodeURIComponent(enrollmentId)}`,
    {
      credentials: "include",
    },
  );
  return handleResponse<DeviceEnrollment>(res);
}

export async function approveDeviceEnrollment(
  enrollmentId: string,
  signatureAlgorithm: string,
  signature: string,
): Promise<void> {
  const res = await fetch(
    `/api/v1/device-enrollments/${encodeURIComponent(enrollmentId)}/approve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ signatureAlgorithm, signature }),
    },
  );
  return handleResponse<void>(res);
}

export async function revokeDevice(deviceId: string): Promise<void> {
  const res = await fetch(
    `/api/v1/devices/${encodeURIComponent(deviceId)}/revoke`,
    {
      method: "POST",
      credentials: "include",
    },
  );
  return handleResponse<void>(res);
}

export interface VaultMetadata {
  id: string;
  protocolVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface VaultKeyEnvelope {
  envelopeType: "password" | "recovery";
  protocolVersion: 1;
  keyWrapAlgorithm: "AES-256-KW";
  kdfAlgorithm: "argon2id13" | "hkdf-sha256";
  kdfParameters: Record<string, number>;
  salt: string;
  wrappedVek: string;
}

export async function listVaults(): Promise<{ items: VaultMetadata[] }> {
  const res = await fetch("/api/v1/vaults", {
    credentials: "include",
  });
  return handleResponse<{ items: VaultMetadata[] }>(res);
}

export async function createVault(params: {
  protocolVersion: number;
  envelopes: VaultKeyEnvelope[];
}): Promise<VaultMetadata> {
  const res = await fetch("/api/v1/vaults", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(params),
  });
  return handleResponse<VaultMetadata>(res);
}

export async function getVault(vaultId: string): Promise<VaultMetadata> {
  const res = await fetch(`/api/v1/vaults/${encodeURIComponent(vaultId)}`, {
    credentials: "include",
  });
  return handleResponse<VaultMetadata>(res);
}

export async function getVaultKeyEnvelope(
  vaultId: string,
  envelopeType: "password" | "recovery",
): Promise<VaultKeyEnvelope> {
  const res = await fetch(
    `/api/v1/vaults/${encodeURIComponent(vaultId)}/envelopes/${encodeURIComponent(envelopeType)}`,
    {
      credentials: "include",
    },
  );
  return handleResponse<VaultKeyEnvelope>(res);
}

export async function putVaultKeyEnvelope(
  vaultId: string,
  envelopeType: "password" | "recovery",
  envelope: VaultKeyEnvelope,
): Promise<void> {
  const res = await fetch(
    `/api/v1/vaults/${encodeURIComponent(vaultId)}/envelopes/${encodeURIComponent(envelopeType)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(envelope),
    },
  );
  return handleResponse<void>(res);
}

export async function deleteVault(vaultId: string): Promise<void> {
  const res = await fetch(`/api/v1/vaults/${encodeURIComponent(vaultId)}`, {
    method: "DELETE",
    credentials: "include",
  });
  return handleResponse<void>(res);
}

export async function getAppConfiguration(): Promise<AppConfiguration> {
  const res = await fetch("/api/v1/app/configuration", {
    credentials: "include",
  });
  return handleResponse<AppConfiguration>(res);
}

export interface SyncEvent {
  sequenceId: string;
  operationId: string;
  deviceId: string;
  objectId: string;
  operationKind: "upsert" | "delete";
  baseRevision: number;
  newRevision: number;
  createdAt: string;
}

export interface SyncPage {
  items: SyncEvent[];
  nextCursor: string;
  hasMore: boolean;
}

export interface SyncOperationResult {
  operationId: string;
  sequenceId: string;
  currentRevision: number;
  accepted: boolean;
}

export async function listSyncEvents(
  vaultId: string,
  after: string = "0",
  limit: number = 100,
): Promise<SyncPage> {
  const params = new URLSearchParams({ after, limit: String(limit) });
  const res = await fetch(
    `/api/v1/vaults/${encodeURIComponent(vaultId)}/sync?${params}`,
    { credentials: "include" },
  );
  return handleResponse<SyncPage>(res);
}

export async function submitSyncOperation(
  vaultId: string,
  op: SyncOperation,
  idempotencyKey?: string,
): Promise<SyncOperationResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }
  const res = await fetch(
    `/api/v1/vaults/${encodeURIComponent(vaultId)}/sync/operations`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(op),
      credentials: "include",
    },
  );
  return handleResponse<SyncOperationResult>(res);
}

export async function getEncryptedObject(
  vaultId: string,
  objectId: string,
  revision?: number,
): Promise<EncryptedObjectEnvelope> {
  const params = revision !== undefined ? `?revision=${revision}` : "";
  const res = await fetch(
    `/api/v1/vaults/${encodeURIComponent(vaultId)}/objects/${encodeURIComponent(objectId)}${params}`,
    { credentials: "include" },
  );
  return handleResponse<EncryptedObjectEnvelope>(res);
}

export async function putEncryptedObject(
  vaultId: string,
  objectId: string,
  ifMatchRevision: number,
  envelope: EncryptedObjectEnvelope,
  idempotencyKey?: string,
): Promise<SyncOperationResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "If-Match-Revision": String(ifMatchRevision),
  };
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }
  const res = await fetch(
    `/api/v1/vaults/${encodeURIComponent(vaultId)}/objects/${encodeURIComponent(objectId)}`,
    {
      method: "PUT",
      headers,
      body: JSON.stringify(envelope),
      credentials: "include",
    },
  );
  return handleResponse<SyncOperationResult>(res);
}

export async function listAttachments(
  vaultId: string,
): Promise<AttachmentList> {
  const res = await fetch(
    `/api/v1/vaults/${encodeURIComponent(vaultId)}/attachments`,
    { credentials: "include" },
  );
  return handleResponse<AttachmentList>(res);
}

export async function createAttachmentUploadSession(
  vaultId: string,
  request: AttachmentUploadSessionRequest,
): Promise<AttachmentUploadSessionResponse> {
  const res = await fetch(
    `/api/v1/vaults/${encodeURIComponent(vaultId)}/attachments/upload-session`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(request),
    },
  );
  return handleResponse<AttachmentUploadSessionResponse>(res);
}

export async function uploadAttachmentCiphertext(
  uploadUrl: string,
  ciphertext: Uint8Array,
): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    credentials: "include",
    body: ciphertext as unknown as BodyInit,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Upload failed (${res.status}): ${text}`);
  }
}

export async function completeAttachmentUpload(
  vaultId: string,
  attachmentId: string,
  request: AttachmentCompleteRequest,
): Promise<AttachmentMetadata> {
  const res = await fetch(
    `/api/v1/vaults/${encodeURIComponent(vaultId)}/attachments/${encodeURIComponent(attachmentId)}/complete`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(request),
    },
  );
  return handleResponse<AttachmentMetadata>(res);
}

export async function createAttachmentDownloadSession(
  vaultId: string,
  attachmentId: string,
): Promise<AttachmentDownloadSessionResponse> {
  const res = await fetch(
    `/api/v1/vaults/${encodeURIComponent(vaultId)}/attachments/${encodeURIComponent(attachmentId)}/download-session`,
    { credentials: "include" },
  );
  return handleResponse<AttachmentDownloadSessionResponse>(res);
}

export async function downloadAttachmentCiphertext(
  downloadUrl: string,
): Promise<Uint8Array> {
  const res = await fetch(downloadUrl, { credentials: "include" });
  if (!res.ok) {
    throw new Error(`Download failed (${res.status})`);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

export async function getAttachment(
  vaultId: string,
  attachmentId: string,
): Promise<AttachmentMetadata> {
  const res = await fetch(
    `/api/v1/vaults/${encodeURIComponent(vaultId)}/attachments/${encodeURIComponent(attachmentId)}`,
    { credentials: "include" },
  );
  return handleResponse<AttachmentMetadata>(res);
}

export async function deleteAttachment(
  vaultId: string,
  attachmentId: string,
): Promise<void> {
  const res = await fetch(
    `/api/v1/vaults/${encodeURIComponent(vaultId)}/attachments/${encodeURIComponent(attachmentId)}`,
    {
      method: "DELETE",
      credentials: "include",
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Delete failed (${res.status}): ${text}`);
  }
}
