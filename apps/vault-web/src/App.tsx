import React, { useEffect, useMemo, useState, useTransition } from "react";
import {
  AccountSession,
  Device,
  VaultMetadata,
  getSession,
  loginAccount,
  logoutAccount,
  registerAccount,
  listDevices,
  approveDeviceEnrollment,
  revokeDevice,
  createDeviceEnrollment,
  listVaults,
  createVault,
  getVaultKeyEnvelope,
  putVaultKeyEnvelope,
  deleteVault,
  getAppConfiguration,
} from "./api";
import { CmsSectionRenderer } from "./components/CmsSectionRenderer";
import {
  createVaultKeyEnvelopes,
  unlockWithPassword,
  unlockWithRecovery,
  changePassword,
} from "./crypto";
import {
  EncryptedRecordRepository,
  searchDecryptedRecords,
} from "./storage/record-repository";
import {
  generatePassword,
  estimatePasswordStrength,
} from "./storage/password-generator";
import { copyToClipboardWithAutoClear } from "./storage/clipboard";
import { setupInactivityTracker } from "./storage/inactivity";
import type {
  AppConfiguration,
  DecryptedRecord,
  PasswordRecord,
  SecureNoteRecord,
  IdentityRecord,
  PaymentRecord,
} from "@pdv/data-models";

function randomBase64Url(length = 32): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function App() {
  const [session, setSession] = useState<AccountSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [clipboardToast, setClipboardToast] = useState<string | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [vaults, setVaults] = useState<VaultMetadata[]>([]);
  const [appConfig, setAppConfig] = useState<AppConfiguration | null>(null);

  // In-memory decrypted VEK map: vaultId -> CryptoKey (volatile only, never persisted)
  const [unlockedKeys, setUnlockedKeys] = useState<Record<string, CryptoKey>>(
    {},
  );

  // Active unlocked vault context for Phase 5 Records Engine
  const [activeVaultId, setActiveVaultId] = useState<string | null>(null);
  const [decryptedRecords, setDecryptedRecords] = useState<DecryptedRecord[]>(
    [],
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<
    "all" | "password" | "secure-note" | "identity" | "payment"
  >("all");
  const [revealedFields, setRevealedFields] = useState<Record<string, boolean>>(
    {},
  );

  const recordRepo = useMemo(() => new EncryptedRecordRepository(), []);

  const [tab, setTab] = useState<"login" | "register">("register");
  const [email, setEmail] = useState("");
  const [deviceLabel, setDeviceLabel] = useState("My Browser");
  const [deviceId, setDeviceId] = useState("");
  const [credentialId, setCredentialId] = useState("");

  const [enrollEnrollmentId, setEnrollEnrollmentId] = useState("");
  const [enrollLabel, setEnrollLabel] = useState("Second Device (Mobile)");
  const [latestChallenge, setLatestChallenge] = useState<string | null>(null);

  // Vault creation state
  const [showCreateVaultModal, setShowCreateVaultModal] = useState(false);
  const [newVaultPassword, setNewVaultPassword] = useState("");
  const [confirmVaultPassword, setConfirmVaultPassword] = useState("");
  const [createdRecoverySecret, setCreatedRecoverySecret] = useState<
    string | null
  >(null);

  // Unlock modal state
  const [unlockModal, setUnlockModal] = useState<{
    vaultId: string;
    mode: "password" | "recovery";
  } | null>(null);
  const [unlockInput, setUnlockInput] = useState("");

  // Change password modal state
  const [changePasswordModal, setChangePasswordModal] = useState<string | null>(
    null,
  );
  const [currentPasswordInput, setCurrentPasswordInput] = useState("");
  const [newPasswordInput, setNewPasswordInput] = useState("");
  const [confirmNewPasswordInput, setConfirmNewPasswordInput] = useState("");

  // Phase 5: Create Record Modal state
  const [showCreateRecordModal, setShowCreateRecordModal] = useState(false);
  const [recordType, setRecordType] = useState<
    "password" | "secure-note" | "identity" | "payment"
  >("password");
  const [recordTitle, setRecordTitle] = useState("");
  const [recordTags, setRecordTags] = useState("");

  // Password fields
  const [pwUrl, setPwUrl] = useState("");
  const [pwUsername, setPwUsername] = useState("");
  const [pwPassword, setPwPassword] = useState("");
  const [pwNotes, setPwNotes] = useState("");

  // Generator panel state
  const [showGenerator, setShowGenerator] = useState(false);
  const [genLength, setGenLength] = useState(20);
  const [genUpper, setGenUpper] = useState(true);
  const [genLower, setGenLower] = useState(true);
  const [genNumbers, setGenNumbers] = useState(true);
  const [genSymbols, setGenSymbols] = useState(true);
  const [genExcludeAmbiguous, setGenExcludeAmbiguous] = useState(true);

  // Note fields
  const [noteContent, setNoteContent] = useState("");

  // Identity fields
  const [idType, setIdType] = useState("Passport");
  const [idNumber, setIdNumber] = useState("");
  const [idCountry, setIdCountry] = useState("");
  const [idExpiry, setIdExpiry] = useState("");

  // Payment fields
  const [payHolder, setPayHolder] = useState("");
  const [payNumber, setPayNumber] = useState("");
  const [payExpiry, setPayExpiry] = useState("");
  const [payNotes, setPayNotes] = useState("");

  // Derivation status
  const [derivationStatus, setDerivationStatus] = useState<string | null>(null);

  const [, startTransition] = useTransition();

  // Inactivity auto-lock: 15 minutes of inactivity clears in-memory keys
  useEffect(() => {
    const tracker = setupInactivityTracker(15 * 60 * 1000, () => {
      setUnlockedKeys({});
      setActiveVaultId(null);
      setDecryptedRecords([]);
      setSuccess(
        "Vaults automatically locked after 15 minutes of inactivity. Memory wiped.",
      );
    });
    return () => tracker.dispose();
  }, []);

  const refreshSession = async () => {
    try {
      setLoading(true);
      setError(null);
      const s = await getSession();
      setSession(s);
      if (s && s.device?.status === "active") {
        const [devList, vaultList, cfg] = await Promise.all([
          listDevices(),
          listVaults(),
          getAppConfiguration().catch(() => null),
        ]);
        setDevices(devList.items);
        setVaults(vaultList.items);
        if (cfg) setAppConfig(cfg);
      } else {
        setDevices([]);
        setVaults([]);
        setAppConfig(null);
      }
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshSession();
  }, []);

  // Refresh decrypted records whenever active vault or unlocked keys change
  const loadRecordsForVault = async (vaultId: string, key: CryptoKey) => {
    try {
      const records = await recordRepo.listRecords(vaultId, key);
      setDecryptedRecords(records);
    } catch (err: unknown) {
      if (err instanceof Error)
        setError(`Failed to load records: ${err.message}`);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const generatedPubKey = randomBase64Url(32);
      const generatedCredId = credentialId.trim() || `cred-${Date.now()}`;
      const s = await registerAccount({
        email: email.trim(),
        deviceLabel: deviceLabel.trim() || "Web Browser",
        platform: navigator.platform || "Web",
        browser: "Chrome / Modern Browser",
        publicKeyAlgorithm: "Ed25519",
        publicKey: generatedPubKey,
        credentialType: "external",
        credentialId: generatedCredId,
      });
      startTransition(() => {
        setSession(s);
        if (s.device?.id) setDeviceId(s.device.id);
      });
      const [devList, vaultList, cfg] = await Promise.all([
        listDevices(),
        listVaults(),
        getAppConfiguration().catch(() => null),
      ]);
      setDevices(devList.items);
      setVaults(vaultList.items);
      if (cfg) setAppConfig(cfg);
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const s = await loginAccount({
        email: email.trim(),
        deviceId: deviceId.trim(),
        credentialType: "external",
        credentialId: credentialId.trim(),
      });
      startTransition(() => {
        setSession(s);
      });
      if (s.device?.status === "active") {
        const [devList, vaultList, cfg] = await Promise.all([
          listDevices(),
          listVaults(),
          getAppConfiguration().catch(() => null),
        ]);
        setDevices(devList.items);
        setVaults(vaultList.items);
        if (cfg) setAppConfig(cfg);
      }
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
    }
  };

  const handleLogout = async () => {
    try {
      await logoutAccount();
      setSession(null);
      setDevices([]);
      setVaults([]);
      setUnlockedKeys({});
      setActiveVaultId(null);
      setDecryptedRecords([]);
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
    }
  };

  const handleCreateEnrollment = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const pubKey = randomBase64Url(32);
      const res = await createDeviceEnrollment({
        deviceLabel: enrollLabel,
        platform: "Mobile / Secondary",
        browser: "Browser Client",
        publicKeyAlgorithm: "Ed25519",
        publicKey: pubKey,
      });
      setLatestChallenge(
        `Enrollment ID: ${res.id}\nChallenge: ${res.challenge}`,
      );
      const devList = await listDevices();
      setDevices(devList.items);
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
    }
  };

  const handleApproveEnrollment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enrollEnrollmentId.trim()) return;
    setError(null);
    try {
      const sig = randomBase64Url(64);
      await approveDeviceEnrollment(enrollEnrollmentId.trim(), "Ed25519", sig);
      setEnrollEnrollmentId("");
      const devList = await listDevices();
      setDevices(devList.items);
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
    }
  };

  const handleRevoke = async (targetId: string) => {
    if (
      !confirm(
        "Are you sure you want to revoke this device? Its sessions will be terminated immediately.",
      )
    ) {
      return;
    }
    setError(null);
    try {
      await revokeDevice(targetId);
      const devList = await listDevices();
      setDevices(devList.items);
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
    }
  };

  // Phase 4: Vault Lifecycle Handlers
  const handleCreateVaultSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!newVaultPassword || newVaultPassword !== confirmVaultPassword) {
      setError("Passwords do not match");
      return;
    }

    try {
      setDerivationStatus(
        "Deriving Argon2id (64 MiB, 3 iterations, p=4) and generating VEK envelopes...",
      );
      const { vek, recoverySecret, passwordEnvelope, recoveryEnvelope } =
        await createVaultKeyEnvelopes(newVaultPassword);

      setDerivationStatus("Creating zero-knowledge vault on server...");
      const created = await createVault({
        protocolVersion: 1,
        envelopes: [passwordEnvelope, recoveryEnvelope],
      });

      // Keep VEK in memory as unlocked
      setUnlockedKeys((prev) => ({ ...prev, [created.id]: vek }));
      setActiveVaultId(created.id);
      loadRecordsForVault(created.id, vek);

      setCreatedRecoverySecret(recoverySecret);
      setNewVaultPassword("");
      setConfirmVaultPassword("");
      setShowCreateVaultModal(false);

      const vaultList = await listVaults();
      setVaults(vaultList.items);
      setSuccess(
        `Vault ${created.id} created successfully! Please save your recovery secret below.`,
      );
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setDerivationStatus(null);
    }
  };

  const handleUnlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!unlockModal) return;
    setError(null);
    setSuccess(null);

    const { vaultId, mode } = unlockModal;
    try {
      setDerivationStatus(
        mode === "password"
          ? "Deriving Argon2id key and unwrapping VEK..."
          : "Deriving HKDF key from recovery secret and unwrapping VEK...",
      );

      const envelope = await getVaultKeyEnvelope(vaultId, mode);
      let vek: CryptoKey;
      if (mode === "password") {
        vek = await unlockWithPassword(unlockInput, envelope);
      } else {
        vek = await unlockWithRecovery(unlockInput, envelope);
      }

      setUnlockedKeys((prev) => ({ ...prev, [vaultId]: vek }));
      setActiveVaultId(vaultId);
      loadRecordsForVault(vaultId, vek);

      setUnlockModal(null);
      setUnlockInput("");
      setSuccess(
        `Vault unlocked successfully! VEK loaded into secure volatile memory.`,
      );
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(`Failed to unlock vault: ${err.message}. Check your ${mode}.`);
      }
    } finally {
      setDerivationStatus(null);
    }
  };

  const handleLockVault = (vaultId: string) => {
    setUnlockedKeys((prev) => {
      const next = { ...prev };
      delete next[vaultId];
      return next;
    });
    if (activeVaultId === vaultId) {
      setActiveVaultId(null);
      setDecryptedRecords([]);
    }
    setSuccess(`Vault locked. In-memory keys and decrypted records cleared.`);
  };

  const handleChangePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!changePasswordModal) return;
    setError(null);
    setSuccess(null);

    if (newPasswordInput !== confirmNewPasswordInput) {
      setError("New passwords do not match");
      return;
    }

    const vaultId = changePasswordModal;
    try {
      setDerivationStatus(
        "Deriving Argon2id (p=4) for new password and re-wrapping VEK...",
      );
      const currentEnvelope = await getVaultKeyEnvelope(vaultId, "password");
      const { vek, passwordEnvelope } = await changePassword(
        currentPasswordInput,
        currentEnvelope,
        newPasswordInput,
      );

      setDerivationStatus(
        "Uploading re-wrapped password envelope to backend...",
      );
      await putVaultKeyEnvelope(vaultId, "password", passwordEnvelope);

      setUnlockedKeys((prev) => ({ ...prev, [vaultId]: vek }));
      setChangePasswordModal(null);
      setCurrentPasswordInput("");
      setNewPasswordInput("");
      setConfirmNewPasswordInput("");
      setSuccess(
        "Vault password changed successfully! VEK re-wrapped with fresh salt.",
      );
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(`Failed to change password: ${err.message}`);
      }
    } finally {
      setDerivationStatus(null);
    }
  };

  const handleDeleteVault = async (vaultId: string) => {
    if (
      !confirm(
        `Are you sure you want to permanently delete vault ${vaultId}? All encrypted data and envelopes will be irreversibly deleted.`,
      )
    ) {
      return;
    }

    setError(null);
    setSuccess(null);
    try {
      await deleteVault(vaultId);
      setUnlockedKeys((prev) => {
        const next = { ...prev };
        delete next[vaultId];
        return next;
      });
      if (activeVaultId === vaultId) {
        setActiveVaultId(null);
        setDecryptedRecords([]);
      }
      const vaultList = await listVaults();
      setVaults(vaultList.items);
      setSuccess(`Vault ${vaultId} deleted permanently.`);
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
    }
  };

  // Phase 5: Records Management Handlers
  const handleCopy = async (text: string, label: string) => {
    try {
      await copyToClipboardWithAutoClear(text, 30_000);
      setClipboardToast(
        `${label} copied to clipboard! Will auto-clear in 30 seconds.`,
      );
      setTimeout(() => setClipboardToast(null), 4000);
    } catch {
      setError("Failed to copy to clipboard");
    }
  };

  const handleGeneratePasswordClick = () => {
    const pw = generatePassword({
      length: genLength,
      uppercase: genUpper,
      lowercase: genLower,
      numbers: genNumbers,
      symbols: genSymbols,
      excludeAmbiguous: genExcludeAmbiguous,
    });
    setPwPassword(pw);
  };

  const handleCreateRecordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeVaultId || !unlockedKeys[activeVaultId]) {
      setError("Vault must be unlocked to save records");
      return;
    }

    const key = unlockedKeys[activeVaultId];
    const tags = recordTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    let recordToSave: DecryptedRecord;
    if (recordType === "password") {
      if (!pwPassword) {
        setError("Password cannot be empty");
        return;
      }
      const pRecord: PasswordRecord = {
        id,
        type: "password",
        title: recordTitle.trim(),
        tags,
        url: pwUrl.trim() || undefined,
        username: pwUsername.trim() || undefined,
        password: pwPassword,
        notes: pwNotes.trim() || undefined,
        createdAt: now,
        updatedAt: now,
      };
      recordToSave = pRecord;
    } else if (recordType === "secure-note") {
      const nRecord: SecureNoteRecord = {
        id,
        type: "secure-note",
        title: recordTitle.trim(),
        tags,
        content: noteContent,
        createdAt: now,
        updatedAt: now,
      };
      recordToSave = nRecord;
    } else if (recordType === "identity") {
      const iRecord: IdentityRecord = {
        id,
        type: "identity",
        title: recordTitle.trim(),
        tags,
        fields: {
          identityType: idType,
          identifierNumber: idNumber.trim() || null,
          country: idCountry.trim() || null,
          expiry: idExpiry.trim() || null,
        },
        createdAt: now,
        updatedAt: now,
      };
      recordToSave = iRecord;
    } else {
      const payRecord: PaymentRecord = {
        id,
        type: "payment",
        title: recordTitle.trim(),
        tags,
        fields: {
          cardholder: payHolder.trim() || null,
          cardNumber: payNumber.trim().replace(/\s+/g, "") || null,
          expiry: payExpiry.trim() || null,
          billingNotes: payNotes.trim() || null,
        },
        createdAt: now,
        updatedAt: now,
      };
      recordToSave = payRecord;
    }

    try {
      await recordRepo.saveRecord(activeVaultId, key, recordToSave);
      await loadRecordsForVault(activeVaultId, key);
      setShowCreateRecordModal(false);

      // Reset form
      setRecordTitle("");
      setRecordTags("");
      setPwUrl("");
      setPwUsername("");
      setPwPassword("");
      setPwNotes("");
      setNoteContent("");
      setIdNumber("");
      setIdCountry("");
      setIdExpiry("");
      setPayHolder("");
      setPayNumber("");
      setPayExpiry("");
      setPayNotes("");
      setShowGenerator(false);

      setSuccess(
        `Record "${recordToSave.title}" encrypted and saved to IndexedDB.`,
      );
    } catch (err: unknown) {
      if (err instanceof Error)
        setError(`Failed to save record: ${err.message}`);
    }
  };

  const handleDeleteRecord = async (objectId: string, title: string) => {
    if (!activeVaultId || !unlockedKeys[activeVaultId]) return;
    if (!confirm(`Are you sure you want to delete "${title}"?`)) return;

    try {
      await recordRepo.deleteRecord(activeVaultId, objectId, 1);
      await loadRecordsForVault(activeVaultId, unlockedKeys[activeVaultId]);
      setSuccess(`Record "${title}" deleted locally; tombstone queued.`);
    } catch (err: unknown) {
      if (err instanceof Error) setError(`Failed to delete: ${err.message}`);
    }
  };

  const toggleReveal = (id: string) => {
    setRevealedFields((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Filter & Search records
  const filteredRecords = useMemo(() => {
    let list = decryptedRecords;
    if (filterType !== "all") {
      list = list.filter((r) => r.type === filterType);
    }
    return searchDecryptedRecords(list, searchQuery);
  }, [decryptedRecords, filterType, searchQuery]);

  const pwStrength = useMemo(
    () => estimatePasswordStrength(pwPassword),
    [pwPassword],
  );

  if (loading) {
    return (
      <main>
        <p className="eyebrow">Personal Digital Vault</p>
        <h1>Loading session...</h1>
      </main>
    );
  }

  return (
    <main
      style={{
        ["--primary-color" as string]:
          appConfig?.theme?.primaryColor || "#1c5230",
        ["--border-radius" as string]: appConfig?.theme?.borderRadius || "8px",
      }}
    >
      <header className="header">
        <div>
          <p className="eyebrow">Personal Digital Vault</p>
          <h1>Zero-Knowledge Encrypted Vault</h1>
        </div>
        {session && (
          <button className="secondary-btn" onClick={handleLogout}>
            Sign Out
          </button>
        )}
      </header>

      {error && <div className="error-banner">{error}</div>}
      {success && <div className="success-banner">{success}</div>}
      {clipboardToast && (
        <div className="success-banner">📋 {clipboardToast}</div>
      )}

      {derivationStatus && (
        <div className="deriving-overlay">
          <span>⏳ {derivationStatus}</span>
        </div>
      )}

      {createdRecoverySecret && (
        <div className="warning-banner">
          <strong>⚠️ Vault Recovery Secret Generated</strong>
          <p>
            Write down or copy this 256-bit recovery secret and store it in an
            offline location.{" "}
            <em>
              If both your password and recovery secret are lost, your vault
              data cannot be recovered by anyone.
            </em>
          </p>
          <div className="secret-display">{createdRecoverySecret}</div>
          <button
            className="secondary-btn"
            onClick={() => setCreatedRecoverySecret(null)}
          >
            I Have Safely Stored My Recovery Secret
          </button>
        </div>
      )}

      {!session ? (
        <section className="card">
          <div className="tab-bar">
            <button
              className={`tab-btn ${tab === "register" ? "active" : ""}`}
              onClick={() => setTab("register")}
            >
              Create Account
            </button>
            <button
              className={`tab-btn ${tab === "login" ? "active" : ""}`}
              onClick={() => setTab("login")}
            >
              Sign In
            </button>
          </div>

          {tab === "register" ? (
            <form onSubmit={handleRegister} className="form">
              <label>
                Account Email
                <input
                  type="email"
                  required
                  placeholder="user@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>

              <label>
                Initial Device Name
                <input
                  type="text"
                  required
                  placeholder="Work Laptop"
                  value={deviceLabel}
                  onChange={(e) => setDeviceLabel(e.target.value)}
                />
              </label>

              <label>
                Auth Credential Identifier
                <input
                  type="text"
                  placeholder="Leave empty for auto-generated ID"
                  value={credentialId}
                  onChange={(e) => setCredentialId(e.target.value)}
                />
              </label>

              <button type="submit" className="primary-btn">
                Register & Enroll Device
              </button>
            </form>
          ) : (
            <form onSubmit={handleLogin} className="form">
              <label>
                Account Email
                <input
                  type="email"
                  required
                  placeholder="user@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>

              <label>
                Registered Device ID (UUID)
                <input
                  type="text"
                  required
                  placeholder="e.g. dev-0001"
                  value={deviceId}
                  onChange={(e) => setDeviceId(e.target.value)}
                />
              </label>

              <label>
                Credential Identifier
                <input
                  type="text"
                  required
                  placeholder="e.g. cred-user-001"
                  value={credentialId}
                  onChange={(e) => setCredentialId(e.target.value)}
                />
              </label>

              <button type="submit" className="primary-btn">
                Sign In
              </button>
            </form>
          )}
        </section>
      ) : session.device?.status === "pending" ? (
        <section className="card pending-card">
          <h2>Device Approval Pending</h2>
          <p className="notice">
            This device has authenticated to{" "}
            <strong>{session.account.email}</strong>, but requires cryptographic
            authorization from one of your existing active devices before
            accessing vault data.
          </p>
          <div className="status-badge pending">Status: Pending Approval</div>
          <button className="primary-btn" onClick={refreshSession}>
            Check Approval Status
          </button>
        </section>
      ) : (
        <div>
          {/* Dynamic Declarative CMS Sections rendered via trusted component registry */}
          {appConfig?.sections
            ?.filter((s) => s.screenKey === "vault_overview" && s.isEnabled)
            .sort((a, b) => a.displayOrder - b.displayOrder)
            .map((sec) => (
              <CmsSectionRenderer
                key={sec.id}
                section={sec}
                actions={{
                  onOpenCreateModal: () => {
                    if (activeVaultId && unlockedKeys[activeVaultId]) {
                      setShowCreateRecordModal(true);
                    } else if (vaults.length > 0) {
                      setUnlockModal({
                        vaultId: vaults[0].id,
                        mode: "password",
                      });
                    } else {
                      setShowCreateVaultModal(true);
                    }
                  },
                  onOpenGenerator: () => setShowGenerator(true),
                  onLockVault: () => {
                    if (activeVaultId) {
                      handleLockVault(activeVaultId);
                    }
                  },
                  recordCount: decryptedRecords.length,
                  vaultUnlocked:
                    !!activeVaultId && !!unlockedKeys[activeVaultId],
                }}
              />
            ))}

          {/* Phase 4 & 5: Vault Management and Record Engine Section */}
          <section className="card">
            <div className="header" style={{ marginBottom: "1rem" }}>
              <div>
                <h2>Your Encrypted Vaults ({vaults.length})</h2>
                <div
                  style={{
                    display: "flex",
                    gap: "0.5rem",
                    alignItems: "center",
                  }}
                >
                  <span className="timer-badge">
                    ⏱️ Auto-lock in 15m inactivity
                  </span>
                  <span className="device-meta">
                    IndexedDB Encrypted at rest (AES-256-GCM / KW)
                  </span>
                </div>
              </div>
              <button
                className="primary-btn"
                onClick={() => setShowCreateVaultModal(true)}
              >
                + Create Vault
              </button>
            </div>

            {vaults.length === 0 ? (
              <p
                className="device-meta"
                style={{ textAlign: "center", padding: "1.5rem" }}
              >
                No vaults found. Click "+ Create Vault" to create your first
                zero-knowledge encrypted vault.
              </p>
            ) : (
              <div className="vault-grid">
                {vaults.map((v) => {
                  const isUnlocked = Boolean(unlockedKeys[v.id]);
                  const isCurrentActive = activeVaultId === v.id;

                  return (
                    <div
                      key={v.id}
                      className={`vault-item ${isUnlocked ? "unlocked" : ""}`}
                    >
                      <div className="vault-header">
                        <div>
                          <div className="vault-id-box">
                            <strong>Vault ID:</strong>
                            <code>{v.id}</code>
                          </div>
                          <div className="device-meta">
                            Protocol v{v.protocolVersion} • Created:{" "}
                            {new Date(v.createdAt).toLocaleString()}
                          </div>
                        </div>
                        <span
                          className={`status-badge ${isUnlocked ? "active" : "pending"}`}
                        >
                          {isUnlocked ? "Unlocked" : "Locked"}
                        </span>
                      </div>

                      <div className="vault-actions">
                        {!isUnlocked ? (
                          <>
                            <button
                              className="primary-btn"
                              onClick={() => {
                                setUnlockModal({
                                  vaultId: v.id,
                                  mode: "password",
                                });
                                setUnlockInput("");
                              }}
                            >
                              Unlock with Password
                            </button>
                            <button
                              className="secondary-btn"
                              onClick={() => {
                                setUnlockModal({
                                  vaultId: v.id,
                                  mode: "recovery",
                                });
                                setUnlockInput("");
                              }}
                            >
                              Unlock with Recovery Secret
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              className={
                                isCurrentActive
                                  ? "primary-btn"
                                  : "secondary-btn"
                              }
                              onClick={() => {
                                setActiveVaultId(v.id);
                                loadRecordsForVault(v.id, unlockedKeys[v.id]);
                              }}
                            >
                              {isCurrentActive
                                ? "Viewing Records"
                                : "View Records"}
                            </button>
                            <button
                              className="secondary-btn"
                              onClick={() => handleLockVault(v.id)}
                            >
                              Lock Vault
                            </button>
                            <button
                              className="secondary-btn"
                              onClick={() => {
                                setChangePasswordModal(v.id);
                                setCurrentPasswordInput("");
                                setNewPasswordInput("");
                                setConfirmNewPasswordInput("");
                              }}
                            >
                              Change Password
                            </button>
                          </>
                        )}
                        <button
                          className="danger-btn"
                          onClick={() => handleDeleteVault(v.id)}
                        >
                          Delete Vault
                        </button>
                      </div>

                      {/* Phase 5: Interactive Encrypted Record Engine */}
                      {isUnlocked && isCurrentActive && (
                        <div className="records-container">
                          <div className="records-toolbar">
                            <div className="filter-group">
                              {(
                                [
                                  ["all", "All"],
                                  ["password", "Passwords"],
                                  ["secure-note", "Notes"],
                                  ["identity", "Identities"],
                                  ["payment", "Payments"],
                                ] as const
                              ).map(([val, label]) => (
                                <button
                                  key={val}
                                  className={`filter-chip ${filterType === val ? "active" : ""}`}
                                  onClick={() => setFilterType(val)}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                            <button
                              className="primary-btn"
                              onClick={() => setShowCreateRecordModal(true)}
                            >
                              + New Record
                            </button>
                          </div>

                          <div style={{ marginBottom: "1rem" }}>
                            <input
                              type="text"
                              style={{ width: "100%" }}
                              placeholder="Search decrypted records (title, tag, username, url)..."
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                            />
                          </div>

                          {filteredRecords.length === 0 ? (
                            <p
                              className="device-meta"
                              style={{ textAlign: "center", padding: "1.5rem" }}
                            >
                              {searchQuery
                                ? "No records matched your search query."
                                : "No records in this vault yet. Click '+ New Record' to create one."}
                            </p>
                          ) : (
                            <div className="record-list">
                              {filteredRecords.map((r) => {
                                const isRevealed = Boolean(
                                  revealedFields[r.id],
                                );

                                return (
                                  <div key={r.id} className="record-card">
                                    <div className="record-card-header">
                                      <div>
                                        <div
                                          style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "0.5rem",
                                          }}
                                        >
                                          <span
                                            className={`type-pill ${r.type}`}
                                          >
                                            {r.type.replace("-", " ")}
                                          </span>
                                          <h3 className="record-title">
                                            {r.title}
                                          </h3>
                                        </div>
                                        {r.tags && r.tags.length > 0 && (
                                          <div className="tags-row">
                                            {r.tags.map((t) => (
                                              <span
                                                key={t}
                                                className="tag-badge"
                                              >
                                                #{t}
                                              </span>
                                            ))}
                                          </div>
                                        )}
                                      </div>
                                      <button
                                        className="danger-btn"
                                        onClick={() =>
                                          handleDeleteRecord(r.id, r.title)
                                        }
                                      >
                                        Delete
                                      </button>
                                    </div>

                                    {/* Type specific fields */}
                                    <div className="record-fields">
                                      {r.type === "password" && (
                                        <>
                                          {r.url && (
                                            <div className="field-line">
                                              <span className="field-label">
                                                URL:
                                              </span>
                                              <span className="field-value">
                                                <a
                                                  href={r.url}
                                                  target="_blank"
                                                  rel="noreferrer"
                                                >
                                                  {r.url}
                                                </a>
                                              </span>
                                            </div>
                                          )}
                                          {r.username && (
                                            <div className="field-line">
                                              <span className="field-label">
                                                Username:
                                              </span>
                                              <span className="field-value">
                                                <span>{r.username}</span>
                                                <button
                                                  className="btn-sm"
                                                  onClick={() =>
                                                    handleCopy(
                                                      r.username!,
                                                      "Username",
                                                    )
                                                  }
                                                >
                                                  Copy
                                                </button>
                                              </span>
                                            </div>
                                          )}
                                          <div className="field-line">
                                            <span className="field-label">
                                              Password:
                                            </span>
                                            <span className="field-value">
                                              <span>
                                                {isRevealed
                                                  ? r.password
                                                  : "••••••••••••"}
                                              </span>
                                              <button
                                                className="btn-sm"
                                                onClick={() =>
                                                  toggleReveal(r.id)
                                                }
                                              >
                                                {isRevealed ? "Hide" : "Show"}
                                              </button>
                                              <button
                                                className="btn-sm"
                                                onClick={() =>
                                                  handleCopy(
                                                    r.password,
                                                    "Password",
                                                  )
                                                }
                                              >
                                                Copy
                                              </button>
                                            </span>
                                          </div>
                                          {r.notes && (
                                            <div
                                              className="field-line"
                                              style={{ marginTop: "0.25rem" }}
                                            >
                                              <span className="field-label">
                                                Notes:
                                              </span>
                                              <span>{r.notes}</span>
                                            </div>
                                          )}
                                        </>
                                      )}

                                      {r.type === "secure-note" && (
                                        <div
                                          style={{
                                            whiteSpace: "pre-wrap",
                                            lineHeight: 1.5,
                                          }}
                                        >
                                          {r.content}
                                        </div>
                                      )}

                                      {r.type === "identity" && (
                                        <>
                                          {Object.entries(r.fields).map(
                                            ([k, val]) => (
                                              <div
                                                key={k}
                                                className="field-line"
                                              >
                                                <span className="field-label">
                                                  {k}:
                                                </span>
                                                <span className="field-value">
                                                  {String(val ?? "")}
                                                </span>
                                              </div>
                                            ),
                                          )}
                                        </>
                                      )}

                                      {r.type === "payment" && (
                                        <>
                                          {r.fields.cardholder && (
                                            <div className="field-line">
                                              <span className="field-label">
                                                Cardholder:
                                              </span>
                                              <span>
                                                {String(r.fields.cardholder)}
                                              </span>
                                            </div>
                                          )}
                                          {r.fields.cardNumber && (
                                            <div className="field-line">
                                              <span className="field-label">
                                                Card Number:
                                              </span>
                                              <span className="field-value">
                                                <span>
                                                  {isRevealed
                                                    ? String(
                                                        r.fields.cardNumber,
                                                      )
                                                    : `•••• •••• •••• ${String(r.fields.cardNumber).slice(-4)}`}
                                                </span>
                                                <button
                                                  className="btn-sm"
                                                  onClick={() =>
                                                    toggleReveal(r.id)
                                                  }
                                                >
                                                  {isRevealed ? "Hide" : "Show"}
                                                </button>
                                                <button
                                                  className="btn-sm"
                                                  onClick={() =>
                                                    handleCopy(
                                                      String(
                                                        r.fields.cardNumber,
                                                      ),
                                                      "Card Number",
                                                    )
                                                  }
                                                >
                                                  Copy
                                                </button>
                                              </span>
                                            </div>
                                          )}
                                          {r.fields.expiry && (
                                            <div className="field-line">
                                              <span className="field-label">
                                                Expires:
                                              </span>
                                              <span>
                                                {String(r.fields.expiry)}
                                              </span>
                                            </div>
                                          )}
                                        </>
                                      )}
                                    </div>

                                    <div
                                      style={{
                                        fontSize: "0.75rem",
                                        color: "#839587",
                                        textAlign: "right",
                                      }}
                                    >
                                      Updated:{" "}
                                      {new Date(r.updatedAt).toLocaleString()}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* Account Overview & Device Management */}
          <section className="card info-card">
            <h2>Account Overview</h2>
            <div className="meta-grid">
              <div>
                <span className="meta-label">Account ID:</span>
                <code>{session.account.id}</code>
              </div>
              <div>
                <span className="meta-label">Email:</span>
                <span>{session.account.email}</span>
              </div>
              <div>
                <span className="meta-label">Current Device:</span>
                <span>
                  {session.device?.label} ({session.device?.platform}) —{" "}
                  <strong className="active-text">
                    {session.device?.status}
                  </strong>
                </span>
              </div>
            </div>
          </section>

          <section className="card">
            <h2>Authorized Devices ({devices.length})</h2>
            <div className="device-list">
              {devices.map((d) => (
                <div key={d.id} className="device-item">
                  <div>
                    <strong>{d.label}</strong>
                    <div className="device-meta">
                      {d.platform} • {d.browser} • ID: <code>{d.id}</code>
                    </div>
                  </div>
                  <div className="device-actions">
                    <span className={`status-badge ${d.status}`}>
                      {d.status}
                    </span>
                    {d.id !== session.device?.id && d.status === "active" && (
                      <button
                        className="danger-btn"
                        onClick={() => handleRevoke(d.id)}
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <h2>Enroll Another Device</h2>
            <form onSubmit={handleCreateEnrollment} className="form-inline">
              <input
                type="text"
                placeholder="New Device Name (e.g. iPad)"
                value={enrollLabel}
                onChange={(e) => setEnrollLabel(e.target.value)}
              />
              <button type="submit" className="primary-btn">
                Start Enrollment Challenge
              </button>
            </form>
            {latestChallenge && (
              <pre className="challenge-box">{latestChallenge}</pre>
            )}
          </section>

          <section className="card">
            <h2>Approve Pending Enrollment</h2>
            <form onSubmit={handleApproveEnrollment} className="form-inline">
              <input
                type="text"
                placeholder="Enter Enrollment ID to approve"
                value={enrollEnrollmentId}
                onChange={(e) => setEnrollEnrollmentId(e.target.value)}
              />
              <button type="submit" className="primary-btn">
                Approve Device
              </button>
            </form>
          </section>
        </div>
      )}

      {/* Modal: Create Vault */}
      {showCreateVaultModal && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>Create New Encrypted Vault</h2>
            <p className="device-meta">
              Your password derives an Argon2id key (64 MiB, 3 iterations, p=4)
              to wrap your Vault Encryption Key (VEK). An offline recovery
              secret is also created.
            </p>
            <form
              onSubmit={handleCreateVaultSubmit}
              className="form"
              style={{ marginTop: "1rem" }}
            >
              <label>
                Vault Master Password
                <input
                  type="password"
                  required
                  placeholder="Enter strong vault password"
                  value={newVaultPassword}
                  onChange={(e) => setNewVaultPassword(e.target.value)}
                />
              </label>

              <label>
                Confirm Vault Master Password
                <input
                  type="password"
                  required
                  placeholder="Confirm vault password"
                  value={confirmVaultPassword}
                  onChange={(e) => setConfirmVaultPassword(e.target.value)}
                />
              </label>

              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setShowCreateVaultModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="primary-btn">
                  Generate Keys & Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Unlock Vault */}
      {unlockModal && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>
              Unlock Vault (
              {unlockModal.mode === "password" ? "Password" : "Recovery Secret"}
              )
            </h2>
            <p className="device-meta">
              Vault ID: <code>{unlockModal.vaultId}</code>
            </p>
            <form
              onSubmit={handleUnlockSubmit}
              className="form"
              style={{ marginTop: "1rem" }}
            >
              <label>
                {unlockModal.mode === "password"
                  ? "Enter Vault Master Password"
                  : "Enter 256-bit Base64URL Recovery Secret"}
                <input
                  type={unlockModal.mode === "password" ? "password" : "text"}
                  required
                  placeholder={
                    unlockModal.mode === "password"
                      ? "Master Password"
                      : "e.g. 43-character base64url string"
                  }
                  value={unlockInput}
                  onChange={(e) => setUnlockInput(e.target.value)}
                />
              </label>

              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setUnlockModal(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="primary-btn">
                  Unlock
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Change Password */}
      {changePasswordModal && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>Change Vault Password</h2>
            <p className="device-meta">
              Rewraps the existing VEK with fresh p=4 salt. The recovery
              envelope remains untouched and independent.
            </p>
            <form
              onSubmit={handleChangePasswordSubmit}
              className="form"
              style={{ marginTop: "1rem" }}
            >
              <label>
                Current Password
                <input
                  type="password"
                  required
                  placeholder="Current master password"
                  value={currentPasswordInput}
                  onChange={(e) => setCurrentPasswordInput(e.target.value)}
                />
              </label>

              <label>
                New Master Password
                <input
                  type="password"
                  required
                  placeholder="New strong password"
                  value={newPasswordInput}
                  onChange={(e) => setNewPasswordInput(e.target.value)}
                />
              </label>

              <label>
                Confirm New Master Password
                <input
                  type="password"
                  required
                  placeholder="Confirm new password"
                  value={confirmNewPasswordInput}
                  onChange={(e) => setConfirmNewPasswordInput(e.target.value)}
                />
              </label>

              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setChangePasswordModal(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="primary-btn">
                  Re-wrap & Update Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Create Record (Phase 5) */}
      {showCreateRecordModal && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>Add New Encrypted Record</h2>
            <div className="tab-bar" style={{ marginTop: "0.5rem" }}>
              <button
                type="button"
                className={`tab-btn ${recordType === "password" ? "active" : ""}`}
                onClick={() => setRecordType("password")}
              >
                Password
              </button>
              <button
                type="button"
                className={`tab-btn ${recordType === "secure-note" ? "active" : ""}`}
                onClick={() => setRecordType("secure-note")}
              >
                Note
              </button>
              <button
                type="button"
                className={`tab-btn ${recordType === "identity" ? "active" : ""}`}
                onClick={() => setRecordType("identity")}
              >
                Identity
              </button>
              <button
                type="button"
                className={`tab-btn ${recordType === "payment" ? "active" : ""}`}
                onClick={() => setRecordType("payment")}
              >
                Payment
              </button>
            </div>

            <form onSubmit={handleCreateRecordSubmit} className="form">
              <label>
                Record Title
                <input
                  type="text"
                  required
                  placeholder="e.g. GitHub, AWS, Passport, Visa"
                  value={recordTitle}
                  onChange={(e) => setRecordTitle(e.target.value)}
                />
              </label>

              <label>
                Tags (comma separated)
                <input
                  type="text"
                  placeholder="e.g. work, cloud, personal"
                  value={recordTags}
                  onChange={(e) => setRecordTags(e.target.value)}
                />
              </label>

              {/* Type specific inputs */}
              {recordType === "password" && (
                <>
                  <label>
                    Website / Service URL
                    <input
                      type="url"
                      placeholder="https://example.com/login"
                      value={pwUrl}
                      onChange={(e) => setPwUrl(e.target.value)}
                    />
                  </label>

                  <label>
                    Username or Email
                    <input
                      type="text"
                      placeholder="username@example.com"
                      value={pwUsername}
                      onChange={(e) => setPwUsername(e.target.value)}
                    />
                  </label>

                  <label>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <span>Password</span>
                      <button
                        type="button"
                        className="btn-sm"
                        onClick={() => setShowGenerator(!showGenerator)}
                      >
                        {showGenerator
                          ? "Hide Generator"
                          : "Password Generator"}
                      </button>
                    </div>
                    <input
                      type="text"
                      required
                      placeholder="Enter or generate password"
                      value={pwPassword}
                      onChange={(e) => setPwPassword(e.target.value)}
                    />
                  </label>

                  {pwPassword && (
                    <div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: "0.78rem",
                        }}
                      >
                        <span>Strength: {pwStrength.label}</span>
                        <span>{pwStrength.entropyBits} bits entropy</span>
                      </div>
                      <div className="strength-bar">
                        <div
                          className="strength-fill"
                          style={{
                            width: `${Math.min(100, (pwStrength.entropyBits / 100) * 100)}%`,
                            backgroundColor: pwStrength.color,
                          }}
                        />
                      </div>
                    </div>
                  )}

                  {showGenerator && (
                    <div className="generator-box">
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: "0.85rem",
                          fontWeight: 600,
                        }}
                      >
                        <span>Length: {genLength}</span>
                        <input
                          type="range"
                          min="8"
                          max="64"
                          value={genLength}
                          onChange={(e) => setGenLength(Number(e.target.value))}
                        />
                      </div>

                      <div className="checkbox-row">
                        <label>
                          <input
                            type="checkbox"
                            checked={genUpper}
                            onChange={(e) => setGenUpper(e.target.checked)}
                          />
                          A-Z
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={genLower}
                            onChange={(e) => setGenLower(e.target.checked)}
                          />
                          a-z
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={genNumbers}
                            onChange={(e) => setGenNumbers(e.target.checked)}
                          />
                          0-9
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={genSymbols}
                            onChange={(e) => setGenSymbols(e.target.checked)}
                          />
                          Symbols
                        </label>
                        <label>
                          <input
                            type="checkbox"
                            checked={genExcludeAmbiguous}
                            onChange={(e) =>
                              setGenExcludeAmbiguous(e.target.checked)
                            }
                          />
                          Exclude Ambiguous (0,O,l,1)
                        </label>
                      </div>

                      <button
                        type="button"
                        className="secondary-btn"
                        style={{ width: "100%", marginTop: "0.5rem" }}
                        onClick={handleGeneratePasswordClick}
                      >
                        ⚡ Generate & Insert Password
                      </button>
                    </div>
                  )}

                  <label>
                    Notes
                    <textarea
                      rows={2}
                      placeholder="Optional notes or security questions"
                      value={pwNotes}
                      onChange={(e) => setPwNotes(e.target.value)}
                    />
                  </label>
                </>
              )}

              {recordType === "secure-note" && (
                <label>
                  Secure Note Content
                  <textarea
                    rows={6}
                    required
                    placeholder="Enter confidential notes or recovery instructions"
                    value={noteContent}
                    onChange={(e) => setNoteContent(e.target.value)}
                  />
                </label>
              )}

              {recordType === "identity" && (
                <>
                  <label>
                    Identity Type
                    <select
                      value={idType}
                      onChange={(e) => setIdType(e.target.value)}
                      style={{ padding: "0.5rem", borderRadius: "6px" }}
                    >
                      <option value="Passport">Passport</option>
                      <option value="Driver License">Driver License</option>
                      <option value="National ID">National ID</option>
                      <option value="Other">Other</option>
                    </select>
                  </label>

                  <label>
                    Identifier / Document Number
                    <input
                      type="text"
                      placeholder="e.g. Z12345678"
                      value={idNumber}
                      onChange={(e) => setIdNumber(e.target.value)}
                    />
                  </label>

                  <label>
                    Issuing Country / Authority
                    <input
                      type="text"
                      placeholder="e.g. United States"
                      value={idCountry}
                      onChange={(e) => setIdCountry(e.target.value)}
                    />
                  </label>

                  <label>
                    Expiry Date
                    <input
                      type="text"
                      placeholder="YYYY-MM-DD"
                      value={idExpiry}
                      onChange={(e) => setIdExpiry(e.target.value)}
                    />
                  </label>
                </>
              )}

              {recordType === "payment" && (
                <>
                  <label>
                    Cardholder Name
                    <input
                      type="text"
                      placeholder="Jane Doe"
                      value={payHolder}
                      onChange={(e) => setPayHolder(e.target.value)}
                    />
                  </label>

                  <label>
                    Card Number
                    <input
                      type="text"
                      placeholder="4000 1234 5678 9010"
                      value={payNumber}
                      onChange={(e) => setPayNumber(e.target.value)}
                    />
                  </label>

                  <label>
                    Expiry (MM/YY)
                    <input
                      type="text"
                      placeholder="12/28"
                      value={payExpiry}
                      onChange={(e) => setPayExpiry(e.target.value)}
                    />
                  </label>

                  <label>
                    Billing Notes
                    <input
                      type="text"
                      placeholder="Billing zip, bank contact, etc."
                      value={payNotes}
                      onChange={(e) => setPayNotes(e.target.value)}
                    />
                  </label>
                </>
              )}

              <div className="modal-actions">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => setShowCreateRecordModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="primary-btn">
                  Encrypt & Save Record
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
