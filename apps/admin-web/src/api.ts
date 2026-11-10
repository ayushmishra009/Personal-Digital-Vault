import type {
  AppConfiguration,
  CmsModule,
  CmsNavigationItem,
  CmsRevision,
  CmsSection,
  CmsThemeSettings,
} from "@pdv/data-models";

export type {
  AppConfiguration,
  CmsModule,
  CmsNavigationItem,
  CmsRevision,
  CmsSection,
  CmsThemeSettings,
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
  await fetch("/api/v1/auth/session", {
    method: "DELETE",
    credentials: "include",
  });
}

// --- CMS API ---

export async function getAppConfiguration(): Promise<AppConfiguration> {
  const res = await fetch("/api/v1/app/configuration", {
    credentials: "include",
  });
  return handleResponse<AppConfiguration>(res);
}

export async function listCmsModules(): Promise<CmsModule[]> {
  const res = await fetch("/api/v1/admin/cms/modules", {
    credentials: "include",
  });
  return handleResponse<CmsModule[]>(res);
}

export async function updateCmsModule(
  moduleKey: string,
  data: {
    displayName: string;
    description: string | null;
    isEnabled: boolean;
    displayOrder: number;
  },
): Promise<CmsModule> {
  const res = await fetch(
    `/api/v1/admin/cms/modules/${encodeURIComponent(moduleKey)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(data),
    },
  );
  return handleResponse<CmsModule>(res);
}

export async function listCmsSections(
  screenKey?: string,
): Promise<CmsSection[]> {
  const url = screenKey
    ? `/api/v1/admin/cms/sections?screenKey=${encodeURIComponent(screenKey)}`
    : "/api/v1/admin/cms/sections";
  const res = await fetch(url, {
    credentials: "include",
  });
  return handleResponse<CmsSection[]>(res);
}

export async function createCmsSection(data: {
  screenKey: string;
  sectionType: string;
  title: string;
  contentPayload: Record<string, unknown>;
  styleConfig: Record<string, unknown>;
  displayOrder: number;
  isEnabled: boolean;
}): Promise<CmsSection> {
  const res = await fetch("/api/v1/admin/cms/sections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  return handleResponse<CmsSection>(res);
}

export async function updateCmsSection(
  sectionId: string,
  data: {
    title: string;
    contentPayload: Record<string, unknown>;
    styleConfig: Record<string, unknown>;
    displayOrder: number;
    isEnabled: boolean;
  },
): Promise<CmsSection> {
  const res = await fetch(
    `/api/v1/admin/cms/sections/${encodeURIComponent(sectionId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(data),
    },
  );
  return handleResponse<CmsSection>(res);
}

export async function deleteCmsSection(sectionId: string): Promise<void> {
  const res = await fetch(
    `/api/v1/admin/cms/sections/${encodeURIComponent(sectionId)}`,
    {
      method: "DELETE",
      credentials: "include",
    },
  );
  return handleResponse<void>(res);
}

export async function listCmsNavigation(): Promise<CmsNavigationItem[]> {
  const res = await fetch("/api/v1/admin/cms/navigation", {
    credentials: "include",
  });
  return handleResponse<CmsNavigationItem[]>(res);
}

export async function updateCmsNavigationItem(
  itemId: string,
  data: {
    label: string;
    displayOrder: number;
    isEnabled: boolean;
  },
): Promise<CmsNavigationItem> {
  const res = await fetch(
    `/api/v1/admin/cms/navigation/${encodeURIComponent(itemId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(data),
    },
  );
  return handleResponse<CmsNavigationItem>(res);
}

export async function getCmsTheme(): Promise<CmsThemeSettings> {
  const res = await fetch("/api/v1/admin/cms/theme", {
    credentials: "include",
  });
  return handleResponse<CmsThemeSettings>(res);
}

export async function updateCmsTheme(data: {
  themePreset: string;
  primaryColor: string;
  borderRadius: string;
  density: string;
}): Promise<CmsThemeSettings> {
  const res = await fetch("/api/v1/admin/cms/theme", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
  return handleResponse<CmsThemeSettings>(res);
}

export async function listCmsRevisions(): Promise<CmsRevision[]> {
  const res = await fetch("/api/v1/admin/cms/revisions", {
    credentials: "include",
  });
  return handleResponse<CmsRevision[]>(res);
}

export async function restoreCmsRevision(
  revisionNumber: number,
): Promise<AppConfiguration> {
  const res = await fetch(
    `/api/v1/admin/cms/revisions/${revisionNumber}/restore`,
    {
      method: "POST",
      credentials: "include",
    },
  );
  return handleResponse<AppConfiguration>(res);
}
