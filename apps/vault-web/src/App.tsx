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
import { estimatePasswordStrength } from "./storage/password-generator";
import type {
  AppConfiguration,
  DecryptedRecord,
  DocumentRecord,
  IdentityRecord,
  PasswordRecord,
  PaymentRecord,
  SecureNoteRecord,
  StagedRestorePlan,
  VaultKeyEnvelope,
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
import { ConflictResolutionModal } from "./components/modals/ConflictResolutionModal";
import { RestoreStagingModal } from "./components/modals/RestoreStagingModal";
import {
  exportVaultBackup,
  stageVaultBackup,
  applyRestorePlan,
  recordBackupMetadataToServer,
} from "./storage/backup";
import {
  getSyncEngine,
  type ActiveConflict,
  type SyncStatus,
} from "./storage/sync-engine";

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

function getFriendlyDeviceName(): string {
  if (typeof navigator === "undefined") return "Personal Computer";
  const ua = navigator.userAgent;
  let os = "Computer";
  if (ua.includes("Win")) os = "Windows PC";
  else if (ua.includes("Mac")) os = "Mac";
  else if (ua.includes("Linux")) os = "Linux PC";
  else if (ua.includes("Android")) os = "Android Device";
  else if (ua.includes("iPhone") || ua.includes("iPad")) os = "iOS Device";

  let browser = "Browser";
  if (ua.includes("Edg/")) browser = "Edge";
  else if (ua.includes("Chrome")) browser = "Chrome";
  else if (ua.includes("Safari")) browser = "Safari";
  else if (ua.includes("Firefox")) browser = "Firefox";

  return `${browser} on ${os}`;
}

function downloadRecoverySheet(email: string, recoverySecret: string) {
  const content = `=======================================================
PERSONAL DIGITAL VAULT - EMERGENCY RECOVERY SHEET
=======================================================
Account Email: ${email}
Created At:    ${new Date().toISOString()}

YOUR 256-BIT RECOVERY KEY:
${recoverySecret}

CRITICAL SECURITY INFORMATION:
- Your recovery key can unlock and recover your vault if you
  ever forget your Master Password.
- The server NEVER has access to your Master Password or VEK.
- Store this sheet offline in a safe physical location.
=======================================================`;

  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pdv-recovery-key-${email.replace(/[^a-zA-Z0-9]/g, "_")}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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

  // Sync and conflict state
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [pendingOpsCount, setPendingOpsCount] = useState(0);
  const [, setConflicts] = useState<ActiveConflict[]>([]);
  const [selectedConflict, setSelectedConflict] =
    useState<ActiveConflict | null>(null);
  const [stagedRestorePlan, setStagedRestorePlan] =
    useState<StagedRestorePlan | null>(null);

  // App configuration & theme
  const [appConfig, setAppConfig] = useState<AppConfiguration | null>(null);
  const [inactivityMinutes, setInactivityMinutes] = useState(15);

  // Auth form state & detection
  const hasStoredDevice = Boolean(
    typeof window !== "undefined" &&
    localStorage.getItem("pdv_last_device_id") &&
    localStorage.getItem("pdv_last_email"),
  );
  const storedDeviceLabel =
    (typeof window !== "undefined" &&
      localStorage.getItem("pdv_last_device_label")) ||
    getFriendlyDeviceName();

  const [authTab, setAuthTab] = useState<"login" | "register">(() =>
    hasStoredDevice ? "login" : "register",
  );
  const [authEmail, setAuthEmail] = useState(
    () =>
      (typeof window !== "undefined" &&
        localStorage.getItem("pdv_last_email")) ||
      "",
  );
  const [authDeviceLabel] = useState(getFriendlyDeviceName);
  const [authDeviceId, setAuthDeviceId] = useState(
    () =>
      (typeof window !== "undefined" &&
        localStorage.getItem("pdv_last_device_id")) ||
      "",
  );
  const [authCredentialId, setAuthCredentialId] = useState(
    () =>
      (typeof window !== "undefined" &&
        localStorage.getItem("pdv_last_credential_id")) ||
      "",
  );

  // Registration & Onboarding states
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerConfirmPassword, setRegisterConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [onboardingSecret, setOnboardingSecret] = useState<string | null>(null);
  const [copiedRecovery, setCopiedRecovery] = useState(false);
  const [savedRecoveryAcknowledged, setSavedRecoveryAcknowledged] =
    useState(false);

  // Sign In states
  const [useManualCredentials, setUseManualCredentials] = useState(false);
  const [pairingChallenge, setPairingChallenge] = useState<string | null>(null);
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false);
  const [authStatusMessage, setAuthStatusMessage] = useState<string | null>(
    null,
  );

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
      const pending = await recordRepo.listPendingOperations(vaultId);
      setPendingOpsCount(pending.length);
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

    const email = authEmail.trim();
    if (!email || !email.includes("@")) {
      setError("Please enter a valid email address");
      return;
    }

    if (registerPassword.length < 8) {
      setError("Master password must be at least 8 characters long");
      return;
    }

    if (registerPassword !== registerConfirmPassword) {
      setError("Master passwords do not match");
      return;
    }

    setIsSubmittingAuth(true);
    try {
      setAuthStatusMessage("Registering account & enrolling secure device...");
      const devLabel = authDeviceLabel.trim() || getFriendlyDeviceName();
      const generatedPubKey = randomBase64Url(32);
      const generatedCredId = authCredentialId.trim() || `cred-${Date.now()}`;

      // 1. Register account & initial trusted device
      const s = await registerAccount({
        email,
        deviceLabel: devLabel,
        platform: navigator.platform || "Web",
        browser: getFriendlyDeviceName(),
        publicKeyAlgorithm: "Ed25519",
        publicKey: generatedPubKey,
        credentialType: "external",
        credentialId: generatedCredId,
        externalSubject: email,
      });

      localStorage.setItem("pdv_last_email", email);
      localStorage.setItem("pdv_last_credential_id", generatedCredId);
      if (s.device?.id) {
        localStorage.setItem("pdv_last_device_id", s.device.id);
        localStorage.setItem("pdv_last_device_label", devLabel);
        setAuthDeviceId(s.device.id);
      }

      setSession(s);

      // 2. Automatically create & unlock initial primary vault with master password
      setAuthStatusMessage(
        "Deriving Argon2id keys & securing your primary vault...",
      );
      const recoverySecret = await handleCreateVault(registerPassword);

      // 3. Load configuration and devices
      const [devList, cfg] = await Promise.all([
        listDevices(),
        getAppConfiguration().catch(() => null),
      ]);
      setDevices(devList.items);
      if (cfg) setAppConfig(cfg);

      // 4. Present recovery key onboarding card
      setOnboardingSecret(recoverySecret);
      showToast("Account & Vault created successfully!");
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsSubmittingAuth(false);
      setAuthStatusMessage(null);
    }
  };

  const handleLogin = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);
    const email = authEmail.trim();
    const devId = authDeviceId.trim();
    const credId = authCredentialId.trim();

    if (!email) {
      setError("Please enter your email address");
      return;
    }
    if (!devId || !credId) {
      setError(
        "Device credentials missing. Please pair this device or enter manual credentials.",
      );
      return;
    }

    setIsSubmittingAuth(true);
    try {
      const s = await loginAccount({
        email,
        deviceId: devId,
        credentialType: "external",
        credentialId: credId,
      });
      localStorage.setItem("pdv_last_email", email);
      localStorage.setItem("pdv_last_device_id", devId);
      localStorage.setItem("pdv_last_credential_id", credId);
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
        showToast("Signed in successfully! Please unlock your vault.");
      }
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  const handlePairNewDevice = async () => {
    setError(null);
    const email = authEmail.trim();
    if (!email || !email.includes("@")) {
      setError("Enter your registered email address first");
      return;
    }

    setIsSubmittingAuth(true);
    try {
      const fakePubKey = randomBase64Url(32);
      const devLabel = `${getFriendlyDeviceName()} (New)`;
      const enr = await createDeviceEnrollment({
        deviceLabel: devLabel,
        platform: navigator.platform || "Web",
        browser: getFriendlyDeviceName(),
        publicKeyAlgorithm: "Ed25519",
        publicKey: fakePubKey,
      });
      setPairingChallenge(enr.challenge);
      showToast(
        "Pairing request created! Approve it from your registered device.",
      );
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
    } finally {
      setIsSubmittingAuth(false);
    }
  };

  const handleForgetDevice = () => {
    localStorage.removeItem("pdv_last_device_id");
    localStorage.removeItem("pdv_last_credential_id");
    localStorage.removeItem("pdv_last_device_label");
    setAuthDeviceId("");
    setAuthCredentialId("");
    setUseManualCredentials(true);
    showToast("Cleared saved device credentials from this browser.");
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

  // Sync actions
  const handleSync = async () => {
    if (!activeVaultId || !unlockedKeys[activeVaultId]) {
      showToast("Unlock vault to synchronize");
      return;
    }
    const key = unlockedKeys[activeVaultId];
    setSyncStatus("syncing");
    const engine = getSyncEngine();
    try {
      const res = await engine.syncVault(activeVaultId, key);
      await loadRecordsForVault(activeVaultId, key);
      if (res.conflicts.length > 0) {
        setConflicts(res.conflicts);
        setSelectedConflict(res.conflicts[0]);
        setSyncStatus("conflict");
        showToast(`⚠️ Sync encountered ${res.conflicts.length} conflict(s)`);
      } else {
        setSyncStatus("idle");
        showToast(
          `Synced: pulled ${res.pulledEvents}, pushed ${res.pushedOperations}`,
        );
      }
    } catch (err: unknown) {
      if (engine.getConflicts().length > 0) {
        const cList = engine.getConflicts();
        setConflicts(cList);
        setSelectedConflict(cList[0]);
        setSyncStatus("conflict");
      } else {
        setSyncStatus("offline");
        showToast(
          `Sync failed: ${err instanceof Error ? err.message : "Network error"}`,
        );
      }
    }
  };

  const handleResolveKeepLocal = async () => {
    if (!activeVaultId || !unlockedKeys[activeVaultId] || !selectedConflict)
      return;
    const key = unlockedKeys[activeVaultId];
    const engine = getSyncEngine();
    await engine.resolveKeepLocal(activeVaultId, key, selectedConflict);
    setSelectedConflict(null);
    setConflicts(engine.getConflicts());
    showToast("Kept local version (re-enqueued with updated base revision)");
    await handleSync();
  };

  const handleResolveKeepRemote = async () => {
    if (!activeVaultId || !selectedConflict) return;
    const engine = getSyncEngine();
    await engine.resolveKeepRemote(activeVaultId, selectedConflict);
    setSelectedConflict(null);
    setConflicts(engine.getConflicts());
    showToast("Accepted server version (local edit discarded)");
    if (unlockedKeys[activeVaultId]) {
      await loadRecordsForVault(activeVaultId, unlockedKeys[activeVaultId]);
    }
  };

  const handleResolveMerge = async (mergedRecord: DecryptedRecord) => {
    if (!activeVaultId || !unlockedKeys[activeVaultId] || !selectedConflict)
      return;
    const key = unlockedKeys[activeVaultId];
    const engine = getSyncEngine();
    await engine.resolveMerge(
      activeVaultId,
      key,
      selectedConflict,
      mergedRecord,
    );
    setSelectedConflict(null);
    setConflicts(engine.getConflicts());
    showToast("Merged record saved and queued for sync");
    await handleSync();
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
    if (!activeVaultId || !unlockedKeys[activeVaultId]) {
      setError("Please unlock the vault before exporting a backup.");
      return;
    }
    const vek = unlockedKeys[activeVaultId];
    try {
      const [passwordEnv, recoveryEnv] = await Promise.all([
        getVaultKeyEnvelope(activeVaultId, "password").catch(() => null),
        getVaultKeyEnvelope(activeVaultId, "recovery").catch(() => null),
      ]);
      const envelopes: VaultKeyEnvelope[] = [];
      if (passwordEnv) envelopes.push(passwordEnv);
      if (recoveryEnv) envelopes.push(recoveryEnv);

      const { package: pkg, blob } = await exportVaultBackup({
        vaultId: activeVaultId,
        vek,
        keyEnvelopes: envelopes,
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `vault-backup-${activeVaultId.slice(0, 8)}-${Date.now()}.pdvbackup`;
      a.click();
      URL.revokeObjectURL(url);

      await recordBackupMetadataToServer(activeVaultId, pkg);
      showToast(
        "Encrypted backup package exported and metadata logged to server!",
      );
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to export backup archive",
      );
    }
  };

  const handleImportBackup = async (file: File) => {
    if (!activeVaultId || !unlockedKeys[activeVaultId]) {
      setError("Please unlock the vault before importing records.");
      return;
    }
    const vek = unlockedKeys[activeVaultId];
    try {
      const text = await file.text();
      const plan = await stageVaultBackup({
        rawJsonOrPackage: text,
        unlockSecret: { vek },
      });
      setStagedRestorePlan(plan);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to stage backup archive: invalid format or corrupted file",
      );
    }
  };

  const handleConfirmRestore = async (options: {
    overwriteConflicts: boolean;
    selectedObjectIds?: string[];
  }) => {
    if (!stagedRestorePlan || !activeVaultId || !unlockedKeys[activeVaultId])
      return;
    try {
      const result = await applyRestorePlan({
        plan: stagedRestorePlan,
        overwriteConflicts: options.overwriteConflicts,
        selectedObjectIds: options.selectedObjectIds,
      });
      const key = unlockedKeys[activeVaultId];
      await loadRecordsForVault(activeVaultId, key);
      showToast(
        `Restored ${result.restoredCount} record(s) into local vault! (${result.skippedCount} skipped)`,
      );
      setStagedRestorePlan(null);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to apply restored backup",
      );
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
    primaryColor: "#ffffff",
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

  // Render Onboarding Emergency Recovery Key Screen (after initial account & vault creation)
  if (onboardingSecret) {
    return (
      <div style={{ maxWidth: 560, margin: "6vh auto", padding: "1.5rem" }}>
        <div
          className="card"
          style={{ borderTop: "2px solid var(--xai-primary, #ffffff)" }}
        >
          <div style={{ textAlign: "center", marginBottom: "1.25rem" }}>
            <span style={{ fontSize: "2.5rem" }}>🎉</span>
            <h1 style={{ fontSize: "1.6rem", margin: "0.5rem 0 0.25rem" }}>
              Welcome to Your Vault!
            </h1>
            <p
              style={{
                color: "var(--xai-mute, #7d8187)",
                fontSize: "0.9rem",
                margin: 0,
              }}
            >
              Your account, primary vault, and encryption keys are ready.
            </p>
          </div>

          <div className="warning-banner" style={{ marginBottom: "1.25rem" }}>
            <strong>⚠️ Save Your Emergency Recovery Key</strong>
            <p style={{ margin: "0.35rem 0 0", lineHeight: 1.4 }}>
              Because your vault is end-to-end encrypted, the server never knows
              your master password. If you ever forget it, this recovery key is
              the <strong>only way</strong> to restore your vault.
            </p>
          </div>

          <div style={{ marginBottom: "1rem" }}>
            <span
              className="caption-mono"
              style={{ display: "block", marginBottom: "0.4rem" }}
            >
              Your 256-Bit Recovery Secret
            </span>
            <div
              className="secret-display font-mono"
              style={{
                fontSize: "1.05rem",
                wordBreak: "break-all",
                textAlign: "center",
                fontWeight: 400,
                marginTop: "0.35rem",
              }}
            >
              {onboardingSecret}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              gap: "0.5rem",
              marginBottom: "1.25rem",
            }}
          >
            <button
              type="button"
              className="secondary-btn"
              style={{ flex: 1, padding: "0.6rem" }}
              onClick={async () => {
                await copyToClipboardWithAutoClear(onboardingSecret, 60_000);
                setCopiedRecovery(true);
                setTimeout(() => setCopiedRecovery(false), 3000);
              }}
            >
              {copiedRecovery ? "✓ Copied to Clipboard!" : "📋 Copy Key"}
            </button>
            <button
              type="button"
              className="secondary-btn"
              style={{ flex: 1, padding: "0.6rem" }}
              onClick={() => downloadRecoverySheet(authEmail, onboardingSecret)}
            >
              💾 Download Sheet (.txt)
            </button>
          </div>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.6rem",
              fontSize: "0.88rem",
              cursor: "pointer",
              marginBottom: "1.25rem",
              userSelect: "none",
            }}
          >
            <input
              type="checkbox"
              checked={savedRecoveryAcknowledged}
              onChange={(e) => setSavedRecoveryAcknowledged(e.target.checked)}
              style={{ width: "1.1rem", height: "1.1rem", cursor: "pointer" }}
            />
            <span>I have safely saved my recovery key offline</span>
          </label>

          <button
            type="button"
            className="primary-btn"
            style={{ width: "100%", padding: "0.75rem", fontSize: "1rem" }}
            disabled={!savedRecoveryAcknowledged}
            onClick={() => {
              setOnboardingSecret(null);
              showToast("Vault unlocked and ready!");
            }}
          >
            Open My Vault ➔
          </button>
        </div>
      </div>
    );
  }

  // Render Authentication Screen
  if (!session) {
    const pwStrength = estimatePasswordStrength(registerPassword);

    return (
      <div style={{ maxWidth: 440, margin: "8vh auto", padding: "1.5rem" }}>
        <div className="card">
          <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
            <span style={{ fontSize: "2.5rem" }}>🛡️</span>
            <h1 style={{ fontSize: "1.75rem", margin: "0.5rem 0 0.25rem" }}>
              Personal Digital Vault
            </h1>
            <p
              style={{
                color: "var(--xai-mute, #7d8187)",
                fontSize: "0.85rem",
                margin: 0,
              }}
            >
              Zero-Knowledge End-to-End Encrypted Storage
            </p>
          </div>

          {error && (
            <div className="error-banner" style={{ marginBottom: "1rem" }}>
              {error}
            </div>
          )}
          {success && (
            <div className="success-banner" style={{ marginBottom: "1rem" }}>
              {success}
            </div>
          )}

          <div className="tab-bar">
            <button
              type="button"
              className={`tab-btn ${authTab === "register" ? "active" : ""}`}
              onClick={() => {
                setAuthTab("register");
                setError(null);
                setPairingChallenge(null);
              }}
            >
              Create Vault
            </button>
            <button
              type="button"
              className={`tab-btn ${authTab === "login" ? "active" : ""}`}
              onClick={() => {
                setAuthTab("login");
                setError(null);
                setPairingChallenge(null);
              }}
            >
              Sign In
            </button>
          </div>

          {authTab === "register" ? (
            <form onSubmit={handleRegister} className="form">
              <div>
                <label>
                  <span>Email Address</span>
                  <input
                    type="email"
                    placeholder="user@example.com"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    required
                    disabled={isSubmittingAuth}
                  />
                </label>
              </div>

              <div>
                <label>
                  <span>Choose Master Password</span>
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="At least 8 characters (12+ recommended)"
                    value={registerPassword}
                    onChange={(e) => setRegisterPassword(e.target.value)}
                    required
                    disabled={isSubmittingAuth}
                  />
                </label>
                {registerPassword && (
                  <div style={{ marginTop: "0.35rem" }}>
                    <div
                      style={{
                        height: 4,
                        width: "100%",
                        background: "var(--xai-canvas-mid, #363a3f)",
                        borderRadius: 2,
                      }}
                    >
                      <div
                        style={{
                          height: "100%",
                          width: `${Math.min(100, (pwStrength.entropyBits / 90) * 100)}%`,
                          backgroundColor: pwStrength.color,
                          borderRadius: 2,
                          transition: "all 0.2s ease",
                        }}
                      />
                    </div>
                    <div
                      style={{
                        fontSize: "0.75rem",
                        color: "var(--xai-mute, #7d8187)",
                        marginTop: "0.2rem",
                      }}
                    >
                      Strength:{" "}
                      <strong style={{ color: pwStrength.color }}>
                        {pwStrength.label}
                      </strong>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label>
                  <span>Confirm Master Password</span>
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="Re-enter your master password"
                    value={registerConfirmPassword}
                    onChange={(e) => setRegisterConfirmPassword(e.target.value)}
                    required
                    disabled={isSubmittingAuth}
                  />
                </label>
              </div>

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: "0.8rem",
                  color: "var(--xai-mute, #7d8187)",
                }}
              >
                <label
                  style={{
                    display: "inline-flex",
                    flexDirection: "row",
                    alignItems: "center",
                    gap: "0.35rem",
                    cursor: "pointer",
                    margin: 0,
                    fontWeight: "normal",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={showPassword}
                    onChange={(e) => setShowPassword(e.target.checked)}
                    style={{ width: "auto" }}
                  />
                  <span>Show password</span>
                </label>
                <span title="Your device is automatically enrolled as trusted">
                  🛡️ {authDeviceLabel}
                </span>
              </div>

              {authStatusMessage && (
                <div
                  style={{
                    background: "var(--xai-canvas-soft, #1a1c20)",
                    border: "1px solid var(--xai-hairline, #212327)",
                    color: "var(--xai-ink, #ffffff)",
                    padding: "0.6rem 0.8rem",
                    borderRadius: "6px",
                    fontSize: "0.85rem",
                  }}
                >
                  ⏳ {authStatusMessage}
                </div>
              )}

              <button
                type="submit"
                className="primary-btn"
                style={{ width: "100%", padding: "0.75rem", fontSize: "1rem" }}
                disabled={isSubmittingAuth}
              >
                {isSubmittingAuth
                  ? "Creating Your Vault..."
                  : "Create Account & Vault 🚀"}
              </button>
            </form>
          ) : hasStoredDevice && !useManualCredentials ? (
            <div>
              <div
                style={{ textAlign: "center", padding: "0.75rem 0 1.25rem" }}
              >
                <div style={{ fontSize: "2.2rem", marginBottom: "0.25rem" }}>
                  👋
                </div>
                <h2 style={{ fontSize: "1.25rem", margin: "0.25rem 0" }}>
                  Welcome Back!
                </h2>
                <p
                  style={{
                    fontWeight: 400,
                    color: "var(--xai-ink, #ffffff)",
                    fontSize: "1.05rem",
                    margin: "0.25rem 0",
                  }}
                >
                  {authEmail}
                </p>
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.35rem",
                    background: "var(--xai-canvas-soft, #1a1c20)",
                    border: "1px solid var(--xai-hairline, #212327)",
                    color: "var(--xai-body, #dadbdf)",
                    padding: "0.25rem 0.65rem",
                    borderRadius: "16px",
                    fontSize: "0.8rem",
                    marginTop: "0.35rem",
                  }}
                >
                  <span>🛡️</span> Trusted Device: {storedDeviceLabel}
                </div>
              </div>

              <button
                type="button"
                className="primary-btn"
                style={{ width: "100%", padding: "0.75rem", fontSize: "1rem" }}
                onClick={() => handleLogin()}
                disabled={isSubmittingAuth}
              >
                {isSubmittingAuth
                  ? "Signing In..."
                  : "Sign In with This Device"}
              </button>

              <div
                style={{
                  marginTop: "1.25rem",
                  textAlign: "center",
                  fontSize: "0.82rem",
                }}
              >
                <button
                  type="button"
                  style={{
                    background: "none",
                    border: "none",
                    color: "var(--xai-mute, #7d8187)",
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                  onClick={() => setUseManualCredentials(true)}
                >
                  Sign in with another account or pair new device
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleLogin} className="form">
              <div>
                <label>
                  <span>Email Address</span>
                  <input
                    type="email"
                    placeholder="user@example.com"
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    required
                    disabled={isSubmittingAuth}
                  />
                </label>
              </div>

              {pairingChallenge ? (
                <div
                  style={{
                    background: "var(--xai-canvas-soft, #1a1c20)",
                    border: "1px solid var(--xai-hairline, #212327)",
                    borderRadius: "8px",
                    padding: "1rem",
                    color: "var(--xai-accent-breeze, #a0c3ec)",
                  }}
                >
                  <strong>📱 Device Pairing Code Generated</strong>
                  <div
                    style={{
                      fontSize: "1.05rem",
                      fontWeight: 700,
                      margin: "0.5rem 0",
                      letterSpacing: "0.08em",
                    }}
                    className="font-mono"
                  >
                    {pairingChallenge.slice(0, 16)}...
                  </div>
                  <p
                    style={{
                      fontSize: "0.82rem",
                      margin: 0,
                      lineHeight: 1.4,
                    }}
                  >
                    Open your already trusted computer or phone, go to{" "}
                    <strong>Settings &gt; Devices</strong>, and click{" "}
                    <strong>Approve</strong>. Once approved, click Sign In.
                  </p>
                </div>
              ) : (
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    type="button"
                    className="secondary-btn"
                    style={{ flex: 1, padding: "0.6rem" }}
                    onClick={handlePairNewDevice}
                    disabled={isSubmittingAuth || !authEmail}
                  >
                    📱 Pair as New Device
                  </button>
                </div>
              )}

              <details
                style={{
                  marginTop: "0.5rem",
                  fontSize: "0.85rem",
                  color: "var(--xai-mute, #7d8187)",
                }}
              >
                <summary
                  style={{
                    cursor: "pointer",
                    fontWeight: 500,
                    padding: "0.25rem 0",
                  }}
                >
                  Developer / Manual Device Credentials
                </summary>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.75rem",
                    marginTop: "0.75rem",
                    padding: "0.75rem",
                    background: "var(--xai-canvas-soft, #1a1c20)",
                    border: "1px solid var(--xai-hairline, #212327)",
                    borderRadius: "6px",
                  }}
                >
                  <div>
                    <label style={{ fontSize: "0.75rem" }}>
                      <span>Device ID (UUID)</span>
                      <input
                        type="text"
                        placeholder="e.g. 67cf5dd1-..."
                        value={authDeviceId}
                        onChange={(e) => setAuthDeviceId(e.target.value)}
                        style={{ width: "100%" }}
                      />
                    </label>
                  </div>
                  <div>
                    <label style={{ fontSize: "0.75rem" }}>
                      <span>Credential Identifier</span>
                      <input
                        type="text"
                        placeholder="e.g. cred-..."
                        value={authCredentialId}
                        onChange={(e) => setAuthCredentialId(e.target.value)}
                        style={{ width: "100%" }}
                      />
                    </label>
                  </div>
                  <button
                    type="submit"
                    className="primary-btn"
                    style={{
                      width: "100%",
                      padding: "0.5rem",
                      fontSize: "0.88rem",
                    }}
                    disabled={
                      isSubmittingAuth || !authDeviceId || !authCredentialId
                    }
                  >
                    {isSubmittingAuth
                      ? "Signing In..."
                      : "Sign In with Manual Credentials"}
                  </button>
                </div>
              </details>

              {hasStoredDevice && (
                <div style={{ textAlign: "center", marginTop: "0.5rem" }}>
                  <button
                    type="button"
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--xai-mute, #7d8187)",
                      cursor: "pointer",
                      fontSize: "0.82rem",
                      textDecoration: "underline",
                    }}
                    onClick={() => setUseManualCredentials(false)}
                  >
                    ← Back to Saved Device
                  </button>
                  <span
                    style={{
                      margin: "0 0.5rem",
                      color: "var(--xai-hairline, #212327)",
                    }}
                  >
                    •
                  </span>
                  <button
                    type="button"
                    style={{
                      background: "none",
                      border: "none",
                      color: "var(--xai-accent-sunset, #ff7a17)",
                      cursor: "pointer",
                      fontSize: "0.82rem",
                      textDecoration: "underline",
                    }}
                    onClick={handleForgetDevice}
                  >
                    Forget this device
                  </button>
                </div>
              )}
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
          style={{
            borderLeft: "2px solid var(--xai-accent-sunset, #ff7a17)",
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>⏳</div>
          <h2>Device Approval Pending</h2>
          <p
            style={{
              color: "var(--xai-mute, #7d8187)",
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
        syncStatus={syncStatus}
        pendingOpsCount={pendingOpsCount}
        onSyncClick={handleSync}
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
              activeVaultId={activeVaultId}
              activeVek={
                activeVaultId ? unlockedKeys[activeVaultId] : undefined
              }
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

      {selectedConflict && (
        <ConflictResolutionModal
          conflict={selectedConflict}
          onKeepLocal={handleResolveKeepLocal}
          onKeepRemote={handleResolveKeepRemote}
          onMerge={handleResolveMerge}
          onClose={() => setSelectedConflict(null)}
        />
      )}

      {stagedRestorePlan && (
        <RestoreStagingModal
          plan={stagedRestorePlan}
          onConfirmRestore={handleConfirmRestore}
          onClose={() => setStagedRestorePlan(null)}
        />
      )}
    </div>
  );
}
