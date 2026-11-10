import React, { useEffect, useState, useTransition } from "react";
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
} from "./api";
import {
  createVaultKeyEnvelopes,
  unlockWithPassword,
  unlockWithRecovery,
  changePassword,
} from "./crypto";

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
  const [devices, setDevices] = useState<Device[]>([]);
  const [vaults, setVaults] = useState<VaultMetadata[]>([]);

  // In-memory decrypted VEK map: vaultId -> CryptoKey (never sent to backend)
  const [unlockedKeys, setUnlockedKeys] = useState<Record<string, CryptoKey>>(
    {},
  );

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

  // Derivation status
  const [derivationStatus, setDerivationStatus] = useState<string | null>(null);

  const [, startTransition] = useTransition();

  const refreshSession = async () => {
    try {
      setLoading(true);
      setError(null);
      const s = await getSession();
      setSession(s);
      if (s && s.device?.status === "active") {
        const [devList, vaultList] = await Promise.all([
          listDevices(),
          listVaults(),
        ]);
        setDevices(devList.items);
        setVaults(vaultList.items);
      } else {
        setDevices([]);
        setVaults([]);
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
      const [devList, vaultList] = await Promise.all([
        listDevices(),
        listVaults(),
      ]);
      setDevices(devList.items);
      setVaults(vaultList.items);
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
        const [devList, vaultList] = await Promise.all([
          listDevices(),
          listVaults(),
        ]);
        setDevices(devList.items);
        setVaults(vaultList.items);
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
    setSuccess(`Vault locked. In-memory keys cleared.`);
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
      const vaultList = await listVaults();
      setVaults(vaultList.items);
      setSuccess(`Vault ${vaultId} deleted permanently.`);
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
    }
  };

  if (loading) {
    return (
      <main>
        <p className="eyebrow">Personal Digital Vault</p>
        <h1>Loading session...</h1>
      </main>
    );
  }

  return (
    <main>
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
          {/* Phase 4: Vault Management Section */}
          <section className="card">
            <div className="header" style={{ marginBottom: "1rem" }}>
              <div>
                <h2>Your Encrypted Vaults ({vaults.length})</h2>
                <p className="device-meta">
                  Zero-knowledge encryption: records and keys are never sent in
                  plaintext.
                </p>
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
                          {isUnlocked ? "Unlocked (In-Memory)" : "Locked"}
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

                      {isUnlocked && (
                        <div
                          style={{
                            marginTop: "1rem",
                            padding: "0.85rem",
                            background: "#f0fdf4",
                            borderRadius: "6px",
                            border: "1px dashed #86efac",
                            fontSize: "0.85rem",
                            color: "#166534",
                          }}
                        >
                          ✓ VEK active in volatile memory. Phase 5 Local
                          Encrypted Record Engine ready.
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
    </main>
  );
}
