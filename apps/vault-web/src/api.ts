import type { AppConfiguration } from "@pdv/data-models";

export type { AppConfiguration };

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
  type: string;
  title: string;
  status: number;
  detail?: string;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let errMessage = `HTTP ${res.status}`;
    try {
      const prob: Problem = await res.json();
      errMessage = prob.detail || prob.title || errMessage;
    } catch {
      // fallback
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
