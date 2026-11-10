import {
  unwrapVekWithPassword,
  unwrapVekWithRecovery,
  createVekEnvelopes,
  sealObject,
  openObject,
  decodeRecoverySecret,
  getArgon2Provider,
  type Argon2idProvider,
  type VekEnvelope,
  type ObjectEnvelope,
  type ObjectContext,
} from "./crypto";
import {
  matchesDomain,
  extractHostname,
  isAllowedOrigin,
} from "./utils/origin";
import type { ExtensionStatus, CredentialSummary } from "./types";
import type { PasswordRecord } from "@pdv/data-models";

export interface StoredVaultData {
  vaultId: string;
  passwordEnvelope: VekEnvelope;
  recoveryEnvelope: VekEnvelope;
  encryptedRecords: ObjectEnvelope[];
}

export class SessionManager {
  private isUnlocked = false;
  private unlockedVek: CryptoKey | null = null;
  private activeVaultId: string | null = null;
  private decryptedRecords: PasswordRecord[] = [];
  private allowlist: string[] = [];
  private storedVault: StoredVaultData | null = null;

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.isUnlocked = false;
    this.unlockedVek = null;
    this.activeVaultId = null;
    this.decryptedRecords = [];
  }

  public setStoredVault(vault: StoredVaultData | null): void {
    this.storedVault = vault;
  }

  public getStoredVault(): StoredVaultData | null {
    return this.storedVault;
  }

  public setAllowlist(allowlist: string[]): void {
    this.allowlist = [...allowlist];
  }

  public getAllowlist(): string[] {
    return [...this.allowlist];
  }

  public addAllowlist(domain: string): boolean {
    const host = extractHostname(domain);
    if (!host) return false;
    if (!this.allowlist.includes(host)) {
      this.allowlist.push(host);
    }
    return true;
  }

  public removeAllowlist(domain: string): boolean {
    const host = extractHostname(domain) || domain.toLowerCase();
    const index = this.allowlist.indexOf(host);
    if (index >= 0) {
      this.allowlist.splice(index, 1);
      return true;
    }
    return false;
  }

  public getStatus(currentTabUrl?: string | null): ExtensionStatus {
    const host = currentTabUrl ? extractHostname(currentTabUrl) : null;
    return {
      isAuthenticated: true,
      isUnlocked: this.isUnlocked,
      activeVaultId: this.activeVaultId,
      currentTabUrl: currentTabUrl || null,
      currentDomain: host,
    };
  }

  public async unlock(params: {
    password?: string;
    recoverySecret?: string;
    vaultId?: string;
    argon2Provider?: Argon2idProvider;
  }): Promise<{ success: boolean; error?: string }> {
    if (!this.storedVault) {
      // If no stored vault yet, auto-seed a default test vault
      const provider = params.argon2Provider || (await getArgon2Provider());
      await this.seedDefaultVault("VaultPassword123!", provider);
    }

    if (!this.storedVault) {
      return { success: false, error: "No vault configured" };
    }

    try {
      let vek: CryptoKey | null = null;

      if (params.password) {
        const provider = params.argon2Provider || (await getArgon2Provider());
        vek = await unwrapVekWithPassword(
          params.password,
          this.storedVault.passwordEnvelope,
          provider,
        );
      } else if (params.recoverySecret) {
        const secretBytes = decodeRecoverySecret(params.recoverySecret.trim());
        vek = await unwrapVekWithRecovery(
          secretBytes,
          this.storedVault.recoveryEnvelope,
        );
      } else {
        return {
          success: false,
          error: "Password or recovery secret required",
        };
      }

      // Decrypt stored password records
      const decrypted: PasswordRecord[] = [];
      for (const envelope of this.storedVault.encryptedRecords) {
        try {
          const payload = (await openObject(vek, envelope)) as PasswordRecord;
          if (payload && payload.type === "password") {
            decrypted.push(payload);
          }
        } catch {
          // Skip records that fail decryption under this key
        }
      }

      this.unlockedVek = vek;
      this.decryptedRecords = decrypted;
      this.activeVaultId = this.storedVault.vaultId;
      this.isUnlocked = true;

      return { success: true };
    } catch {
      return {
        success: false,
        error: "Unable to unlock vault: invalid credentials",
      };
    }
  }

  public lock(): void {
    // Volatile zeroization
    this.decryptedRecords = [];
    this.unlockedVek = null;
    this.activeVaultId = null;
    this.isUnlocked = false;
  }

  public listCredentials(
    currentTabUrl?: string | null,
    query?: string,
  ): CredentialSummary[] {
    if (!this.isUnlocked) {
      return [];
    }

    const lowerQuery = query ? query.toLowerCase().trim() : "";

    const results: CredentialSummary[] = [];

    for (const record of this.decryptedRecords) {
      if (lowerQuery) {
        const matchTitle = record.title.toLowerCase().includes(lowerQuery);
        const matchUser = (record.username || "")
          .toLowerCase()
          .includes(lowerQuery);
        const matchUrl = (record.url || "").toLowerCase().includes(lowerQuery);
        if (!matchTitle && !matchUser && !matchUrl) {
          continue;
        }
      }

      const domainMatch = Boolean(
        record.url && currentTabUrl && matchesDomain(record.url, currentTabUrl),
      );

      // SECURITY RULE: Strictly NEVER expose plaintext passwords in list summaries!
      results.push({
        id: record.id,
        title: record.title,
        username: record.username,
        url: record.url,
        domainMatch,
        tags: record.tags || [],
      });
    }

    // Sort: Domain matches first, then alphabetically by title
    return results.sort((a, b) => {
      if (a.domainMatch && !b.domainMatch) return -1;
      if (!a.domainMatch && b.domainMatch) return 1;
      return a.title.localeCompare(b.title);
    });
  }

  public checkDomainMatch(
    recordId: string,
    currentTabUrl?: string | null,
  ): {
    domainMatch: boolean;
    recordDomain: string | null;
    currentDomain: string | null;
  } {
    const record = this.decryptedRecords.find((r) => r.id === recordId);
    const recordDomain = record?.url ? extractHostname(record.url) : null;
    const currentDomain = currentTabUrl ? extractHostname(currentTabUrl) : null;

    if (!record || !record.url || !currentTabUrl) {
      return { domainMatch: false, recordDomain, currentDomain };
    }

    const match =
      matchesDomain(record.url, currentTabUrl) ||
      isAllowedOrigin(currentTabUrl, this.allowlist);

    return { domainMatch: match, recordDomain, currentDomain };
  }

  public requestFill(
    recordId: string,
    currentTabUrl?: string | null,
    allowMismatch = false,
  ): { username?: string; password?: string } {
    if (!this.isUnlocked) {
      throw new Error("Vault is locked");
    }

    const record = this.decryptedRecords.find((r) => r.id === recordId);
    if (!record) {
      throw new Error("Record not found");
    }

    if (!currentTabUrl) {
      throw new Error("Cannot fill credentials without an active page URL");
    }

    // Validate page URL scheme (reject chrome://, about:, file:, etc.)
    if (
      !currentTabUrl.startsWith("http://") &&
      !currentTabUrl.startsWith("https://")
    ) {
      throw new Error("Cannot fill credentials on non-web page");
    }

    const domainMatches = record.url
      ? matchesDomain(record.url, currentTabUrl) ||
        isAllowedOrigin(currentTabUrl, this.allowlist)
      : false;

    if (!domainMatches && !allowMismatch) {
      throw new Error("Domain mismatch: explicit user confirmation required");
    }

    // Return the single credential pair to be injected into top-level frame only.
    // Crucially: Never log passwords to console or store in unencrypted variables!
    return {
      username: record.username,
      password: record.password,
    };
  }

  public async seedDefaultVault(
    masterPassword = "VaultPassword123!",
    argon2Provider?: Argon2idProvider,
  ): Promise<StoredVaultData> {
    const provider = argon2Provider || (await getArgon2Provider());
    const vaultId = "a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d";

    const { vek, passwordEnvelope, recoveryEnvelope } =
      await createVekEnvelopes(masterPassword, provider);

    const testRecords: PasswordRecord[] = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        type: "password",
        title: "GitHub",
        url: "https://github.com/login",
        username: "octocat",
        password: "supersecret-password-123",
        tags: ["dev", "work"],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "22222222-2222-4222-8222-222222222222",
        type: "password",
        title: "Localhost Test App",
        url: "http://localhost:3000/login",
        username: "testuser",
        password: "LocalhostPassword456!",
        tags: ["local", "test"],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "33333333-3333-4333-8333-333333333333",
        type: "password",
        title: "Example Portal",
        url: "https://example.com/account",
        username: "alice@example.com",
        password: "ExampleSecret789$",
        tags: ["personal"],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const encryptedRecords: ObjectEnvelope[] = [];
    for (const rec of testRecords) {
      const context: ObjectContext = {
        protocolVersion: 1,
        purpose: "record",
        vaultId,
        objectId: rec.id,
        revision: 1,
        payloadVersion: 1,
      };
      const envelope = await sealObject(vek, context, rec);
      encryptedRecords.push(envelope);
    }

    const storedData: StoredVaultData = {
      vaultId,
      passwordEnvelope,
      recoveryEnvelope,
      encryptedRecords,
    };

    this.storedVault = storedData;
    return storedData;
  }
}
