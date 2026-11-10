import React, { useState, useEffect, useCallback } from "react";
import { browser } from "wxt/browser";
import type {
  ExtensionStatus,
  CredentialSummary,
  FillResult,
} from "../../src/types";
import { extractHostname } from "../../src/utils/origin";

export const Popup: React.FC = () => {
  const [status, setStatus] = useState<ExtensionStatus | null>(null);
  const [activeTab, setActiveTab] = useState<"vault" | "allowlist">("vault");
  const [credentials, setCredentials] = useState<CredentialSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Auth inputs
  const [password, setPassword] = useState("");
  const [recoverySecret, setRecoverySecret] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);

  // Search
  const [searchQuery, setSearchQuery] = useState("");

  // Domain Mismatch State
  const [mismatchTarget, setMismatchTarget] =
    useState<CredentialSummary | null>(null);
  const [mismatchAck, setMismatchAck] = useState(false);

  // Allowlist
  const [allowlist, setAllowlist] = useState<string[]>([]);
  const [newDomain, setNewDomain] = useState("");

  const refreshStatus = useCallback(async () => {
    try {
      const res = await browser.runtime.sendMessage({ type: "GET_STATUS" });
      if (res?.success) {
        setStatus(res.data);
      }
    } catch {
      setError("Unable to connect to extension background worker.");
    }
  }, []);

  const refreshCredentials = useCallback(async (query?: string) => {
    try {
      const res = await browser.runtime.sendMessage({
        type: "LIST_CREDENTIALS",
        query,
      });
      if (res?.success) {
        setCredentials(res.data);
      }
    } catch {
      // Background worker might be locked
    }
  }, []);

  const refreshAllowlist = useCallback(async () => {
    try {
      const res = await browser.runtime.sendMessage({ type: "GET_ALLOWLIST" });
      if (res?.success) {
        setAllowlist(res.data);
      }
    } catch {
      // Ignore
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus]);

  useEffect(() => {
    if (status?.isUnlocked) {
      refreshCredentials(searchQuery);
      refreshAllowlist();
    }
  }, [status?.isUnlocked, searchQuery, refreshCredentials, refreshAllowlist]);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const payload = useRecovery
        ? { recoverySecret: recoverySecret.trim() }
        : { password };

      const res = await browser.runtime.sendMessage({
        type: "UNLOCK_VAULT",
        ...payload,
      });

      if (res?.success) {
        setPassword("");
        setRecoverySecret("");
        await refreshStatus();
      } else {
        setError(res?.error || "Invalid credentials.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unlock failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleLock = async () => {
    setError(null);
    setSuccessMsg(null);
    setMismatchTarget(null);
    try {
      await browser.runtime.sendMessage({ type: "LOCK_VAULT" });
      await refreshStatus();
      setCredentials([]);
    } catch {
      // Ignore
    }
  };

  const handleFillRequest = async (
    cred: CredentialSummary,
    forceMismatch = false,
  ) => {
    setError(null);
    setSuccessMsg(null);

    // If domain does not match current tab and not explicitly forced, show warning
    if (!cred.domainMatch && !forceMismatch) {
      setMismatchTarget(cred);
      setMismatchAck(false);
      return;
    }

    setLoading(true);
    try {
      const res = await browser.runtime.sendMessage({
        type: "REQUEST_FILL",
        recordId: cred.id,
        allowMismatch: forceMismatch,
      });

      if (res?.success && res.data) {
        const fillResult = res.data as FillResult;
        if (fillResult.success) {
          setSuccessMsg(`Filled ${cred.title} credentials successfully.`);
          setMismatchTarget(null);
        } else {
          setError(
            fillResult.error || "No compatible login form found on page.",
          );
        }
      } else {
        setError(res?.error || "Failed to fill credentials.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fill request failed.");
    } finally {
      setLoading(false);
    }
  };

  const handleAddAllowlist = async (domainToAdd: string) => {
    if (!domainToAdd.trim()) return;
    setError(null);
    try {
      const res = await browser.runtime.sendMessage({
        type: "ADD_ALLOWLIST",
        domain: domainToAdd.trim(),
      });
      if (res?.success) {
        setAllowlist(res.data);
        setNewDomain("");
        setSuccessMsg(`Added ${domainToAdd} to allowed origins.`);
      }
    } catch {
      setError("Failed to add domain to allowlist.");
    }
  };

  const handleRemoveAllowlist = async (domainToRemove: string) => {
    setError(null);
    try {
      const res = await browser.runtime.sendMessage({
        type: "REMOVE_ALLOWLIST",
        domain: domainToRemove,
      });
      if (res?.success) {
        setAllowlist(res.data);
      }
    } catch {
      setError("Failed to remove domain from allowlist.");
    }
  };

  const handleSeedDemo = async () => {
    setLoading(true);
    setError(null);
    try {
      await browser.runtime.sendMessage({
        type: "SEED_VAULT",
        password: "VaultPassword123!",
      });
      setPassword("VaultPassword123!");
      setSuccessMsg("Demo vault seeded. Click Unlock to proceed.");
    } catch {
      setError("Failed to seed demo vault.");
    } finally {
      setLoading(false);
    }
  };

  const currentHost = status?.currentDomain || "No active web page";

  return (
    <div className="popup-container">
      {/* Header */}
      <header className="header">
        <div className="brand">
          <svg className="brand-icon" viewBox="0 0 24 24">
            <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z" />
          </svg>
          <span>Personal Vault</span>
        </div>
        <div className="header-actions">
          <span className="domain-pill" title={status?.currentTabUrl || ""}>
            {currentHost}
          </span>
          {status?.isUnlocked && (
            <button
              className="icon-btn"
              onClick={handleLock}
              title="Lock Vault immediately"
            >
              🔒 Lock
            </button>
          )}
        </div>
      </header>

      {/* Tabs (when unlocked) */}
      {status?.isUnlocked && !mismatchTarget && (
        <nav className="nav-tabs">
          <button
            className={`tab-btn ${activeTab === "vault" ? "active" : ""}`}
            onClick={() => setActiveTab("vault")}
          >
            Credentials
          </button>
          <button
            className={`tab-btn ${activeTab === "allowlist" ? "active" : ""}`}
            onClick={() => setActiveTab("allowlist")}
          >
            Allowed Origins
          </button>
        </nav>
      )}

      {/* Main Content Area */}
      <main className="content">
        {error && <div className="alert alert-danger">{error}</div>}
        {successMsg && <div className="alert alert-success">{successMsg}</div>}

        {/* 1. DOMAIN MISMATCH WARNING SCREEN */}
        {mismatchTarget ? (
          <div className="mismatch-screen">
            <div className="alert alert-warning">
              <strong>
                ⚠️ Security Alert: Potential Phishing or Domain Mismatch
              </strong>
              <p style={{ marginTop: 4 }}>
                The credential you selected does not match the website in your
                active browser tab.
              </p>
            </div>

            <div className="mismatch-box">
              <div className="mismatch-row">
                <span className="mismatch-label">Credential Title:</span>
                <span className="mismatch-val">{mismatchTarget.title}</span>
              </div>
              <div className="mismatch-row">
                <span className="mismatch-label">Saved For:</span>
                <span
                  className="mismatch-val"
                  style={{ color: "var(--warning)" }}
                >
                  {mismatchTarget.url
                    ? extractHostname(mismatchTarget.url)
                    : "Unknown URL"}
                </span>
              </div>
              <div className="mismatch-row">
                <span className="mismatch-label">Current Page:</span>
                <span
                  className="mismatch-val"
                  style={{ color: "var(--danger)" }}
                >
                  {currentHost}
                </span>
              </div>
            </div>

            <label className="ack-checkbox">
              <input
                type="checkbox"
                checked={mismatchAck}
                onChange={(e) => setMismatchAck(e.target.checked)}
              />
              <span>
                I understand the security risk of entering my credentials on a
                different origin ({currentHost}).
              </span>
            </label>

            <div className="actions-row">
              <button
                className="btn btn-secondary"
                onClick={() => setMismatchTarget(null)}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger"
                disabled={!mismatchAck || loading}
                onClick={() => handleFillRequest(mismatchTarget, true)}
              >
                {loading ? "Filling..." : "Fill Anyway"}
              </button>
            </div>
          </div>
        ) : !status?.isUnlocked ? (
          /* 2. LOCKED VIEW */
          <form onSubmit={handleUnlock}>
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <h2 style={{ fontSize: 16, fontWeight: 600 }}>Vault is Locked</h2>
              <p
                style={{
                  fontSize: 12,
                  color: "var(--text-secondary)",
                  marginTop: 4,
                }}
              >
                Enter your credentials to unlock and fill logins.
              </p>
            </div>

            {!useRecovery ? (
              <div className="form-group">
                <label className="form-label" htmlFor="vault-password">
                  Master Password
                </label>
                <input
                  id="vault-password"
                  type="password"
                  className="form-input"
                  placeholder="Enter vault password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                  required
                />
              </div>
            ) : (
              <div className="form-group">
                <label className="form-label" htmlFor="vault-recovery">
                  Recovery Secret
                </label>
                <input
                  id="vault-recovery"
                  type="text"
                  className="form-input"
                  placeholder="Base64url recovery key"
                  value={recoverySecret}
                  onChange={(e) => setRecoverySecret(e.target.value)}
                  autoFocus
                  required
                />
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary"
              disabled={loading || (!password && !recoverySecret)}
            >
              {loading ? "Unlocking..." : "Unlock Vault"}
            </button>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                marginTop: 12,
              }}
            >
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setUseRecovery(!useRecovery);
                  setError(null);
                }}
              >
                {useRecovery ? "Use master password" : "Use recovery secret"}
              </button>

              <button
                type="button"
                className="link-btn"
                onClick={handleSeedDemo}
                style={{ color: "var(--text-muted)" }}
              >
                Seed Demo Vault
              </button>
            </div>
          </form>
        ) : activeTab === "vault" ? (
          /* 3. UNLOCKED VIEW: CREDENTIALS */
          <div>
            <div className="search-box">
              <input
                type="text"
                className="form-input"
                placeholder="Search credentials..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="credentials-list">
              {credentials.length === 0 ? (
                <div className="empty-state">
                  No matching credentials found.
                </div>
              ) : (
                credentials.map((cred) => (
                  <div
                    key={cred.id}
                    className={`credential-card ${cred.domainMatch ? "matched" : ""}`}
                  >
                    <div className="credential-info">
                      <div className="credential-title-row">
                        <span className="credential-title">{cred.title}</span>
                        {cred.domainMatch ? (
                          <span className="credential-badge badge-match">
                            Matches Page
                          </span>
                        ) : (
                          <span className="credential-badge badge-other">
                            Other Domain
                          </span>
                        )}
                      </div>
                      {cred.username && (
                        <span className="credential-user">{cred.username}</span>
                      )}
                      {cred.url && (
                        <span className="credential-url">
                          {extractHostname(cred.url)}
                        </span>
                      )}
                    </div>

                    <button
                      className={`fill-btn ${!cred.domainMatch ? "mismatch-btn" : ""}`}
                      onClick={() => handleFillRequest(cred)}
                      disabled={loading}
                      title={
                        cred.domainMatch
                          ? "Fill into page"
                          : "Different domain: requires review"
                      }
                    >
                      Fill
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          /* 4. ALLOWLIST VIEW */
          <div>
            <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
              Approved Origins
            </h3>
            <p
              style={{
                fontSize: 11,
                color: "var(--text-secondary)",
                marginBottom: 12,
              }}
            >
              Domains listed here can match across subdomains or bypass mismatch
              alerts.
            </p>

            {status?.currentDomain &&
              !allowlist.includes(status.currentDomain) && (
                <div style={{ marginBottom: 12 }}>
                  <button
                    className="btn btn-secondary"
                    onClick={() => handleAddAllowlist(status.currentDomain!)}
                  >
                    + Add Current Domain ({status.currentDomain})
                  </button>
                </div>
              )}

            <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. example.com"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
              />
              <button
                className="btn btn-primary"
                style={{ width: "auto", whiteSpace: "nowrap" }}
                onClick={() => handleAddAllowlist(newDomain)}
              >
                Add
              </button>
            </div>

            <div className="credentials-list">
              {allowlist.length === 0 ? (
                <div className="empty-state">No custom allowed origins.</div>
              ) : (
                allowlist.map((domain) => (
                  <div
                    key={domain}
                    className="credential-card"
                    style={{ justifyContent: "space-between" }}
                  >
                    <span>{domain}</span>
                    <button
                      className="icon-btn"
                      onClick={() => handleRemoveAllowlist(domain)}
                      style={{ color: "var(--danger)" }}
                    >
                      Remove
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
