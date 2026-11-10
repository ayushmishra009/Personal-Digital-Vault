import React, { useEffect, useMemo, useState, useTransition } from "react";
import type { AccountSession, Device, VaultMetadata } from "./api";
import {
  approveDeviceEnrollment,
  createDeviceEnrollment,
  createVault,
  getAppConfiguration,
  getSession,
  getVaultKeyEnvelope,
  listDevices,
  listVaults,
  loginAccount,
  logoutAccount,
  putVaultKeyEnvelope,
  registerAccount,
  revokeDevice,
} from "./api";
import {
  changePassword,
  createVaultKeyEnvelopes,
  unlockWithPassword,
  unlockWithRecovery,
} from "./crypto";
import {
  EncryptedRecordRepository,
  searchDecryptedRecords,
} from "./storage/record-repository";
import { copyToClipboardWithAutoClear } from "./storage/clipboard";
import { setupInactivityTracker } from "./storage/inactivity";
import type {
  AppConfiguration,
  DecryptedRecord,
  DocumentRecord,
  IdentityRecord,
  PasswordRecord,
  PaymentRecord,
  SecureNoteRecord,
} from "@pdv/data-models";

import { AppNavbar } from "./components/AppNavbar";
import { AppSidebar, type ActiveNavTab } from "./components/AppSidebar";
import { DashboardView } from "./components/DashboardView";
import { PasswordsView } from "./components/PasswordsView";
import { NotesView } from "./components/NotesView";
import { IdentitiesView } from "./components/IdentitiesView";
import { PaymentsView } from "./components/PaymentsView";
import { DocumentsView } from "./components/DocumentsView";
import { SettingsView } from "./components/SettingsView";
import { DevicesView } from "./components/DevicesView";
import { RecoveryView } from "./components/RecoveryView";

import { RecordModal } from "./components/modals/RecordModal";
import { CreateVaultModal } from "./components/modals/CreateVaultModal";
import { UnlockVaultModal } from "./components/modals/UnlockVaultModal";
import { ChangePasswordModal } from "./components/modals/ChangePasswordModal";
import { PasswordGeneratorModal } from "./components/modals/PasswordGeneratorModal";

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

  // Devices & Vaults
  const [devices, setDevices] = useState<Device[]>([]);
  const [vaults, setVaults] = useState<VaultMetadata[]>([]);
  const [activeVaultId, setActiveVaultId] = useState<string | null>(null);
  const [unlockedKeys, setUnlockedKeys] = useState<Record<string, CryptoKey>>(
    {},
  );

  // Active view & search
  const [currentTab, setCurrentTab] = useState<ActiveNavTab>("dashboard");
  const [searchQuery, setSearchQuery] = useState("");
  const [decryptedRecords, setDecryptedRecords] = useState<DecryptedRecord[]>(
    [],
  );

  // Modals state
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [editingRecord, setEditingRecord] = useState<DecryptedRecord | null>(
    null,
  );
  const [showCreateVaultModal, setShowCreateVaultModal] = useState(false);
  const [unlockVaultId, setUnlockVaultId] = useState<string | null>(null);
  const [changePwVaultId, setChangePwVaultId] = useState<string | null>(null);
  const [showGeneratorModal, setShowGeneratorModal] = useState(false);

  // App configuration & theme
  const [appConfig, setAppConfig] = useState<AppConfiguration | null>(null);
  const [inactivityMinutes, setInactivityMinutes] = useState(15);

  // Auth form state
  const [authTab, setAuthTab] = useState<"login" | "register">("register");
  const [authEmail, setAuthEmail] = useState("");
  const [authDeviceLabel, setAuthDeviceLabel] = useState("My Browser");
  const [authDeviceId, setAuthDeviceId] = useState("");
  const [authCredentialId, setAuthCredentialId] = useState("");

  const [, startTransition] = useTransition();
  const recordRepo = useMemo(() => new EncryptedRecordRepository(), []);

  // Setup Inactivity Tracker: auto-locks vault after inactivityMinutes
  useEffect(() => {
    const tracker = setupInactivityTracker(
      inactivityMinutes * 60 * 1000,
      () => {
        setUnlockedKeys({});
        setDecryptedRecords([]);
        setClipboardToast(
          `Vault locked automatically after ${inactivityMinutes} minutes of inactivity.`,
        );
      },
    );
    return () => tracker.dispose();
  }, [inactivityMinutes]);

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
        if (vaultList.items.length > 0 && !activeVaultId) {
          setActiveVaultId(vaultList.items[0].id);
        }
      } else {
        setDevices([]);
        setVaults([]);
        setAppConfig(null);
        setUnlockedKeys({});
        setDecryptedRecords([]);
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
      if (err instanceof Error) {
        setError(`Failed to load records: ${err.message}`);
      }
    }
  };

  const showToast = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(null), 4000);
  };

  const handleCopy = async (text: string, label: string) => {
    try {
      await copyToClipboardWithAutoClear(text, 30_000);
      setClipboardToast(`${label} copied to clipboard (clears in 30s)`);
      setTimeout(() => setClipboardToast(null), 4000);
    } catch {
      setError("Clipboard access denied by browser");
    }
  };

  // Auth actions
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const generatedPubKey = randomBase64Url(32);
      const generatedCredId = authCredentialId.trim() || `cred-${Date.now()}`;
      const s = await registerAccount({
        email: authEmail.trim(),
        deviceLabel: authDeviceLabel.trim() || "Web Browser",
        platform: navigator.platform || "Web",
        browser: "Chrome / Modern Browser",
        publicKeyAlgorithm: "Ed25519",
        publicKey: generatedPubKey,
        credentialType: "external",
        credentialId: generatedCredId,
      });
      startTransition(() => {
        setSession(s);
        if (s.device?.id) setAuthDeviceId(s.device.id);
      });
      const [devList, vaultList, cfg] = await Promise.all([
        listDevices(),
        listVaults(),
        getAppConfiguration().catch(() => null),
      ]);
      setDevices(devList.items);
      setVaults(vaultList.items);
      if (cfg) setAppConfig(cfg);
      if (vaultList.items.length > 0) setActiveVaultId(vaultList.items[0].id);
      showToast("Registered and enrolled initial device!");
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const s = await loginAccount({
        email: authEmail.trim(),
        deviceId: authDeviceId.trim(),
        credentialType: "external",
        credentialId: authCredentialId.trim(),
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
        if (vaultList.items.length > 0) setActiveVaultId(vaultList.items[0].id);
        showToast("Signed in successfully!");
      }
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
    }
  };

  const handleLogout = async () => {
    try {
      await logoutAccount();
      setSession(null);
      setUnlockedKeys({});
      setDecryptedRecords([]);
      showToast("Signed out. All memory keys cleared.");
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
    }
  };

  // Vault lifecycle actions
  const handleCreateVault = async (masterPassword: string): Promise<string> => {
    const createdEnvelopes = await createVaultKeyEnvelopes(masterPassword);

    const created = await createVault({
      protocolVersion: 1,
      envelopes: [
        createdEnvelopes.passwordEnvelope,
        createdEnvelopes.recoveryEnvelope,
      ],
    });

    setUnlockedKeys((prev) => ({
      ...prev,
      [created.id]: createdEnvelopes.vek,
    }));
    setActiveVaultId(created.id);
    const vaultList = await listVaults();
    setVaults(vaultList.items);
    await loadRecordsForVault(created.id, createdEnvelopes.vek);
    showToast(`Vault created and unlocked with Argon2id (p=4)!`);
    return createdEnvelopes.recoverySecret;
  };

  const handleUnlockPassword = async (vaultId: string, password: string) => {
    const passwordEnv = await getVaultKeyEnvelope(vaultId, "password");
    const key = await unlockWithPassword(password, passwordEnv);
    setUnlockedKeys((prev) => ({ ...prev, [vaultId]: key }));
    setActiveVaultId(vaultId);
    await loadRecordsForVault(vaultId, key);
    showToast("Vault unlocked successfully!");
  };

  const handleUnlockRecovery = async (vaultId: string, secret: string) => {
    const recoveryEnv = await getVaultKeyEnvelope(vaultId, "recovery");
    const key = await unlockWithRecovery(secret, recoveryEnv);
    setUnlockedKeys((prev) => ({ ...prev, [vaultId]: key }));
    setActiveVaultId(vaultId);
    await loadRecordsForVault(vaultId, key);
    showToast("Vault unlocked with recovery secret!");
  };

  const handleLockVault = (vaultId: string) => {
    setUnlockedKeys((prev) => {
      const next = { ...prev };
      delete next[vaultId];
      return next;
    });
    setDecryptedRecords([]);
    showToast("Vault locked. Memory keys wiped.");
  };

  const handleChangePassword = async (currentPw: string, newPw: string) => {
    if (!activeVaultId) return;
    const currentEnv = await getVaultKeyEnvelope(activeVaultId, "password");
    const res = await changePassword(currentPw, currentEnv, newPw);

    await putVaultKeyEnvelope(activeVaultId, "password", res.passwordEnvelope);
    setUnlockedKeys((prev) => ({ ...prev, [activeVaultId]: res.vek }));
    showToast("Master password updated successfully with fresh salt!");
  };

  // Record actions
  const handleSaveRecord = async (record: DecryptedRecord) => {
    if (!activeVaultId || !unlockedKeys[activeVaultId]) {
      throw new Error("Vault is locked. Unlock to save records.");
    }
    const key = unlockedKeys[activeVaultId];
    await recordRepo.saveRecord(activeVaultId, key, record);
    await loadRecordsForVault(activeVaultId, key);
    showToast(`Saved record "${record.title}"`);
  };

  const handleDeleteRecord = async (record: DecryptedRecord) => {
    if (!activeVaultId || !unlockedKeys[activeVaultId]) return;
    if (!window.confirm(`Delete "${record.title}"?`)) return;

    const key = unlockedKeys[activeVaultId];
    await recordRepo.deleteRecord(activeVaultId, record.id, 1);
    await loadRecordsForVault(activeVaultId, key);
    showToast(`Deleted record "${record.title}"`);
  };

  // Device actions
  const handleApproveDevice = async (
    enrollmentId: string,
    challenge: string,
  ) => {
    await approveDeviceEnrollment(enrollmentId, "Ed25519", randomBase64Url(64));
    const devList = await listDevices();
    setDevices(devList.items);
    showToast(`Device approved (challenge ${challenge.slice(0, 8)}...)`);
  };

  const handleRevokeDevice = async (deviceId: string) => {
    await revokeDevice(deviceId);
    const devList = await listDevices();
    setDevices(devList.items);
    showToast("Device revoked.");
  };

  const handleCreateEnrollment = async (
    label: string,
  ): Promise<string | null> => {
    const fakePubKey = randomBase64Url(32);
    const enr = await createDeviceEnrollment({
      deviceLabel: label,
      platform: "Mobile / Secondary",
      browser: "Safari / Mobile",
      publicKeyAlgorithm: "Ed25519",
      publicKey: fakePubKey,
    });
    return enr.challenge;
  };

  // Backup actions
  const handleExportBackup = async () => {
    if (!activeVaultId) return;
    const stored = await recordRepo.listStoredRecords(activeVaultId);
    const backupData = {
      version: 1,
      vaultId: activeVaultId,
      exportedAt: new Date().toISOString(),
      recordCount: stored.length,
      records: stored,
    };
    const blob = new Blob([JSON.stringify(backupData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pdv-backup-${activeVaultId.slice(0, 8)}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Encrypted backup downloaded!");
  };

  const handleImportBackup = async (file: File) => {
    if (!activeVaultId || !unlockedKeys[activeVaultId]) {
      setError("Please unlock the vault before importing records.");
      return;
    }
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed.records)) {
        throw new Error("Invalid backup format: missing records array");
      }
      for (const item of parsed.records) {
        if (item.envelope) {
          await recordRepo.putRawStoredRecord({
            vaultId: activeVaultId,
            objectId: item.objectId,
            envelope: item.envelope,
            revision: item.revision || 1,
            payloadVersion: 1,
            updatedAt: new Date().toISOString(),
          });
        }
      }
      const key = unlockedKeys[activeVaultId];
      await loadRecordsForVault(activeVaultId, key);
      showToast(`Restored ${parsed.records.length} records into local vault!`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to import backup");
    }
  };

  const handleClearLocalCache = async () => {
    if (
      !window.confirm(
        "Clear local IndexedDB storage cache? All cached local data will be reset.",
      )
    ) {
      return;
    }
    await recordRepo.clear();
    setDecryptedRecords([]);
    setUnlockedKeys({});
    showToast("Local IndexedDB storage cache cleared.");
  };

  // Filter records by global search
  const filteredRecords = searchDecryptedRecords(decryptedRecords, searchQuery);

  const isVaultUnlocked = activeVaultId ? !!unlockedKeys[activeVaultId] : false;
  const pendingDeviceCount = devices.filter(
    (d) => d.status === "pending",
  ).length;

  const currentTheme = appConfig?.theme || {
    themePreset: "default",
    primaryColor: "#1c5230",
    borderRadius: "8px",
    density: "comfortable",
  };

  // Render Loading state
  if (loading && !session) {
    return (
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "100vh",
        }}
      >
        <p>Loading session and security engine...</p>
      </div>
    );
  }

  // Render Authentication Screen
  if (!session) {
    return (
      <div style={{ maxWidth: 440, margin: "8vh auto", padding: "1.5rem" }}>
        <div className="card">
          <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
            <span style={{ fontSize: "2.5rem" }}>🛡️</span>
            <h1 style={{ fontSize: "1.75rem", margin: "0.5rem 0 0.25rem" }}>
              Personal Digital Vault
            </h1>
            <p style={{ color: "#556b5a", fontSize: "0.85rem", margin: 0 }}>
              Zero-Knowledge End-to-End Encrypted Storage
            </p>
          </div>

          {error && <div className="alert alert-danger">{error}</div>}
          {success && <div className="alert alert-success">{success}</div>}

          <div className="tab-bar">
            <button
              type="button"
              className={`tab-btn ${authTab === "register" ? "active" : ""}`}
              onClick={() => {
                setAuthTab("register");
                setError(null);
              }}
            >
              Register Account
            </button>
            <button
              type="button"
              className={`tab-btn ${authTab === "login" ? "active" : ""}`}
              onClick={() => {
                setAuthTab("login");
                setError(null);
              }}
            >
              Sign In
            </button>
          </div>

          {authTab === "register" ? (
            <form onSubmit={handleRegister} className="form">
              <div className="form-group">
                <label>Email Address</label>
                <input
                  type="email"
                  className="form-control"
                  placeholder="user@example.com"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Device Label</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="e.g. Work Laptop"
                  value={authDeviceLabel}
                  onChange={(e) => setAuthDeviceLabel(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Credential Identifier (Optional)</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="Auto-generated if blank"
                  value={authCredentialId}
                  onChange={(e) => setAuthCredentialId(e.target.value)}
                />
              </div>

              <button
                type="submit"
                className="btn-primary"
                style={{ width: "100%", marginTop: "0.5rem" }}
              >
                Register & Enroll Device
              </button>
            </form>
          ) : (
            <form onSubmit={handleLogin} className="form">
              <div className="form-group">
                <label>Email Address</label>
                <input
                  type="email"
                  className="form-control"
                  placeholder="user@example.com"
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Registered Device ID (UUID)</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="e.g. dev-0001"
                  value={authDeviceId}
                  onChange={(e) => setAuthDeviceId(e.target.value)}
                  required
                />
              </div>

              <div className="form-group">
                <label>Credential Identifier</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="e.g. cred-user-001"
                  value={authCredentialId}
                  onChange={(e) => setAuthCredentialId(e.target.value)}
                  required
                />
              </div>

              <button
                type="submit"
                className="btn-primary"
                style={{ width: "100%", marginTop: "0.5rem" }}
              >
                Sign In
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  // Render Pending Device Authorization screen
  if (session.device?.status === "pending") {
    return (
      <div style={{ maxWidth: 500, margin: "10vh auto", padding: "1.5rem" }}>
        <div
          className="card"
          style={{ borderLeft: "4px solid #f59e0b", textAlign: "center" }}
        >
          <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>⏳</div>
          <h2>Device Approval Pending</h2>
          <p
            style={{
              color: "#556b5a",
              fontSize: "0.9rem",
              margin: "0.5rem 0 1.25rem",
            }}
          >
            This device has authenticated to{" "}
            <strong>{session.account.email}</strong>, but requires cryptographic
            authorization from one of your active devices before accessing vault
            data.
          </p>
          <div
            className="badge badge-screen"
            style={{ display: "inline-block", marginBottom: "1rem" }}
          >
            Enrollment Device ID: {session.device.id}
          </div>
          <div
            style={{ display: "flex", gap: "0.5rem", justifyContent: "center" }}
          >
            <button
              type="button"
              className="btn-primary"
              onClick={refreshSession}
            >
              Check Approval Status
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={handleLogout}
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Render Full Application Shell
  return (
    <div
      className="app-shell"
      style={{
        ["--primary-color" as string]: currentTheme.primaryColor,
        ["--border-radius" as string]: currentTheme.borderRadius,
      }}
    >
      <AppNavbar
        session={session}
        vaults={vaults}
        activeVaultId={activeVaultId}
        unlockedKeys={unlockedKeys}
        onSelectVault={(id) => {
          setActiveVaultId(id);
          if (unlockedKeys[id]) {
            loadRecordsForVault(id, unlockedKeys[id]);
          } else {
            setDecryptedRecords([]);
          }
        }}
        onCreateVaultClick={() => setShowCreateVaultModal(true)}
        onLockVault={handleLockVault}
        onUnlockVaultClick={(id) => setUnlockVaultId(id)}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onOpenGenerator={() => setShowGeneratorModal(true)}
        onLogout={handleLogout}
      />

      <div className="app-container">
        <AppSidebar
          currentTab={currentTab}
          onSelectTab={setCurrentTab}
          records={decryptedRecords}
          isVaultUnlocked={isVaultUnlocked}
          onOpenCreateRecord={() => {
            setEditingRecord(null);
            setShowRecordModal(true);
          }}
          onCreateVaultClick={() => setShowCreateVaultModal(true)}
          pendingDeviceCount={pendingDeviceCount}
        />

        <main className="main-content-area">
          {error && <div className="alert alert-danger">{error}</div>}
          {success && <div className="alert alert-success">{success}</div>}
          {clipboardToast && (
            <div className="alert alert-info">📋 {clipboardToast}</div>
          )}

          {currentTab === "dashboard" && (
            <DashboardView
              appConfig={appConfig}
              vaults={vaults}
              activeVaultId={activeVaultId}
              isVaultUnlocked={isVaultUnlocked}
              records={filteredRecords}
              onUnlockClick={(id) => setUnlockVaultId(id)}
              onCreateVaultClick={() => setShowCreateVaultModal(true)}
              onChangePasswordClick={(id) => setChangePwVaultId(id)}
              onOpenCreateRecord={() => {
                setEditingRecord(null);
                setShowRecordModal(true);
              }}
              onOpenGenerator={() => setShowGeneratorModal(true)}
              onSelectRecord={(r) => {
                if (r.type === "password") setCurrentTab("passwords");
                else if (r.type === "secure-note") setCurrentTab("notes");
                else if (r.type === "identity") setCurrentTab("identities");
                else if (r.type === "payment") setCurrentTab("payments");
                else if (r.type === "document") setCurrentTab("documents");
              }}
              onLockVault={handleLockVault}
            />
          )}

          {currentTab === "passwords" && (
            <PasswordsView
              records={filteredRecords.filter(
                (r): r is PasswordRecord => r.type === "password",
              )}
              onOpenCreate={() => {
                setEditingRecord(null);
                setShowRecordModal(true);
              }}
              onOpenEdit={(r) => {
                setEditingRecord(r);
                setShowRecordModal(true);
              }}
              onDelete={handleDeleteRecord}
              onCopy={handleCopy}
              onOpenGenerator={() => setShowGeneratorModal(true)}
            />
          )}

          {currentTab === "notes" && (
            <NotesView
              records={filteredRecords.filter(
                (r): r is SecureNoteRecord => r.type === "secure-note",
              )}
              onOpenCreate={() => {
                setEditingRecord(null);
                setShowRecordModal(true);
              }}
              onOpenEdit={(r) => {
                setEditingRecord(r);
                setShowRecordModal(true);
              }}
              onDelete={handleDeleteRecord}
              onCopy={handleCopy}
            />
          )}

          {currentTab === "identities" && (
            <IdentitiesView
              records={filteredRecords.filter(
                (r): r is IdentityRecord => r.type === "identity",
              )}
              onOpenCreate={() => {
                setEditingRecord(null);
                setShowRecordModal(true);
              }}
              onOpenEdit={(r) => {
                setEditingRecord(r);
                setShowRecordModal(true);
              }}
              onDelete={handleDeleteRecord}
              onCopy={handleCopy}
            />
          )}

          {currentTab === "payments" && (
            <PaymentsView
              records={filteredRecords.filter(
                (r): r is PaymentRecord => r.type === "payment",
              )}
              onOpenCreate={() => {
                setEditingRecord(null);
                setShowRecordModal(true);
              }}
              onOpenEdit={(r) => {
                setEditingRecord(r);
                setShowRecordModal(true);
              }}
              onDelete={handleDeleteRecord}
              onCopy={handleCopy}
            />
          )}

          {currentTab === "documents" && (
            <DocumentsView
              records={filteredRecords.filter(
                (r): r is DocumentRecord => r.type === "document",
              )}
              onOpenCreate={() => {
                setEditingRecord(null);
                setShowRecordModal(true);
              }}
              onOpenEdit={(r) => {
                setEditingRecord(r);
                setShowRecordModal(true);
              }}
              onDelete={handleDeleteRecord}
            />
          )}

          {currentTab === "devices" && (
            <DevicesView
              devices={devices}
              currentDeviceId={session.device?.id}
              onApproveDevice={handleApproveDevice}
              onRevokeDevice={handleRevokeDevice}
              onCreateEnrollment={handleCreateEnrollment}
            />
          )}

          {currentTab === "recovery" && (
            <RecoveryView
              vaults={vaults}
              activeVaultId={activeVaultId}
              onExportBackup={handleExportBackup}
              onImportBackup={handleImportBackup}
            />
          )}

          {currentTab === "settings" && (
            <SettingsView
              session={session}
              theme={currentTheme}
              onUpdateTheme={(th) => {
                if (appConfig) {
                  setAppConfig({ ...appConfig, theme: th });
                }
              }}
              inactivityTimeoutMinutes={inactivityMinutes}
              onChangeInactivityTimeout={setInactivityMinutes}
              onClearLocalCache={handleClearLocalCache}
            />
          )}
        </main>
      </div>

      {/* MODALS */}
      {showRecordModal && (
        <RecordModal
          editingRecord={editingRecord}
          defaultType={
            currentTab === "passwords"
              ? "password"
              : currentTab === "notes"
                ? "secure-note"
                : currentTab === "identities"
                  ? "identity"
                  : currentTab === "payments"
                    ? "payment"
                    : currentTab === "documents"
                      ? "document"
                      : "password"
          }
          onSave={handleSaveRecord}
          onClose={() => {
            setShowRecordModal(false);
            setEditingRecord(null);
          }}
        />
      )}

      {showCreateVaultModal && (
        <CreateVaultModal
          onCreate={handleCreateVault}
          onClose={() => setShowCreateVaultModal(false)}
        />
      )}

      {unlockVaultId && (
        <UnlockVaultModal
          vaultId={unlockVaultId}
          onUnlockPassword={handleUnlockPassword}
          onUnlockRecovery={handleUnlockRecovery}
          onClose={() => setUnlockVaultId(null)}
        />
      )}

      {changePwVaultId && (
        <ChangePasswordModal
          vaultId={changePwVaultId}
          onChangePassword={handleChangePassword}
          onClose={() => setChangePwVaultId(null)}
        />
      )}

      {showGeneratorModal && (
        <PasswordGeneratorModal
          onCopy={handleCopy}
          onClose={() => setShowGeneratorModal(false)}
        />
      )}
    </div>
  );
}
