import React from "react";
import type { AppConfiguration, DecryptedRecord } from "@pdv/data-models";
import { CmsSectionRenderer } from "./CmsSectionRenderer";
import type { VaultMetadata } from "../api";

interface DashboardViewProps {
  appConfig: AppConfiguration | null;
  vaults: VaultMetadata[];
  activeVaultId: string | null;
  isVaultUnlocked: boolean;
  records: DecryptedRecord[];
  onUnlockClick: (vaultId: string) => void;
  onCreateVaultClick: () => void;
  onChangePasswordClick: (vaultId: string) => void;
  onOpenCreateRecord: () => void;
  onOpenGenerator: () => void;
  onSelectRecord: (record: DecryptedRecord) => void;
  onLockVault: (vaultId: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  appConfig,
  vaults,
  activeVaultId,
  isVaultUnlocked,
  records,
  onUnlockClick,
  onCreateVaultClick,
  onChangePasswordClick,
  onOpenCreateRecord,
  onOpenGenerator,
  onSelectRecord,
  onLockVault,
}) => {
  const activeVault = vaults.find((v) => v.id === activeVaultId);

  // If no vaults created yet
  if (vaults.length === 0) {
    return (
      <div className="dashboard-view">
        <div className="empty-state-card">
          <div className="empty-icon">🛡️</div>
          <h2>Welcome to Personal Digital Vault</h2>
          <p>
            You have not created an encrypted vault yet. Your vault is secured
            by a master password using Argon2id (p=4) and AES-256-GCM
            authenticated encryption.
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={onCreateVaultClick}
          >
            + Create Your First Vault
          </button>
        </div>
      </div>
    );
  }

  // If active vault is locked
  if (!isVaultUnlocked && activeVault) {
    return (
      <div className="dashboard-view">
        <div className="locked-state-card">
          <div className="locked-icon">🔒</div>
          <h2>Vault is Locked</h2>
          <p>
            Vault <code>{activeVault.id.slice(0, 8)}...</code> is locked. Enter
            your master password or 256-bit recovery secret to unwrap your Vault
            Encryption Key (VEK) into client memory.
          </p>
          <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
            <button
              type="button"
              className="btn-primary"
              onClick={() => onUnlockClick(activeVault.id)}
            >
              🔓 Unlock with Password
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => onUnlockClick(activeVault.id)}
            >
              🔑 Use Recovery Secret
            </button>
          </div>
        </div>
      </div>
    );
  }

  const recentRecords = records.slice(0, 5);
  const passwordCount = records.filter((r) => r.type === "password").length;
  const notesCount = records.filter((r) => r.type === "secure-note").length;
  const identityCount = records.filter((r) => r.type === "identity").length;
  const paymentCount = records.filter((r) => r.type === "payment").length;

  return (
    <div className="dashboard-view">
      {/* Dynamic CMS Sections */}
      {appConfig?.sections
        ?.filter((s) => s.screenKey === "vault_overview" && s.isEnabled)
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((sec) => (
          <CmsSectionRenderer
            key={sec.id}
            section={sec}
            actions={{
              onOpenCreateModal: onOpenCreateRecord,
              onOpenGenerator,
              onLockVault: () => activeVaultId && onLockVault(activeVaultId),
              recordCount: records.length,
              vaultUnlocked: isVaultUnlocked,
            }}
          />
        ))}

      {/* Metrics Grid */}
      <div className="metrics-grid">
        <div className="metric-card">
          <div className="metric-header">
            <span className="metric-title">TOTAL RECORDS</span>
            <span className="metric-icon">📦</span>
          </div>
          <div className="metric-value">{records.length}</div>
          <div className="metric-subtitle">Encrypted in local IndexedDB</div>
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <span className="metric-title">PASSWORDS</span>
            <span className="metric-icon">🔑</span>
          </div>
          <div className="metric-value">{passwordCount}</div>
          <div className="metric-subtitle">
            Zero-knowledge login credentials
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <span className="metric-title">SECURE NOTES</span>
            <span className="metric-icon">📝</span>
          </div>
          <div className="metric-value">{notesCount}</div>
          <div className="metric-subtitle">Markdown & private documents</div>
        </div>

        <div className="metric-card">
          <div className="metric-header">
            <span className="metric-title">FINANCIAL & IDENTITY</span>
            <span className="metric-icon">💳</span>
          </div>
          <div className="metric-value">{paymentCount + identityCount}</div>
          <div className="metric-subtitle">Cards & identity records</div>
        </div>
      </div>

      {/* Quick Actions & Recent Activity Layout */}
      <div className="dashboard-columns">
        {/* Recent Items */}
        <div className="card dashboard-main-col">
          <div className="card-header">
            <h3 style={{ margin: 0, fontSize: "1.1rem" }}>
              Recent Records ({records.length})
            </h3>
            <button
              type="button"
              className="btn-secondary"
              style={{ fontSize: "0.8rem", padding: "0.25rem 0.5rem" }}
              onClick={onOpenCreateRecord}
            >
              + Add Item
            </button>
          </div>

          {recentRecords.length > 0 ? (
            <div className="recent-items-list">
              {recentRecords.map((r) => (
                <div
                  key={r.id}
                  className="recent-item-row"
                  onClick={() => onSelectRecord(r)}
                  style={{ cursor: "pointer" }}
                >
                  <div className="item-icon-col">
                    {r.type === "password" && "🔑"}
                    {r.type === "secure-note" && "📝"}
                    {r.type === "identity" && "🪪"}
                    {r.type === "payment" && "💳"}
                    {r.type === "document" && "📁"}
                  </div>
                  <div className="item-details-col">
                    <div className="item-title">{r.title}</div>
                    <div className="item-meta">
                      <span className="item-type-badge">{r.type}</span>
                      {r.tags.map((t) => (
                        <span key={t} className="tag-badge">
                          #{t}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="item-time-col">
                    {new Date(r.updatedAt).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p
              style={{ color: "var(--xai-mute, #7d8187)", fontSize: "0.9rem", margin: "1rem 0" }}
            >
              No records in this vault yet. Click "+ Add Item" to store your
              first password or note.
            </p>
          )}
        </div>

        {/* Vault Settings & Security Card */}
        <div className="card dashboard-side-col">
          <h3 style={{ margin: "0 0 1rem", fontSize: "1.1rem" }}>
            Active Vault Security
          </h3>
          <div className="vault-sec-item">
            <div className="sec-label">KDF Algorithm</div>
            <div className="sec-value">Argon2id v1.3 (p=4, m=64MB, t=3)</div>
          </div>
          <div className="vault-sec-item">
            <div className="sec-label">Payload Encryption</div>
            <div className="sec-value">AES-256-GCM Authenticated</div>
          </div>
          <div className="vault-sec-item">
            <div className="sec-label">Key Wrap</div>
            <div className="sec-value">AES-256-KW with HKDF-SHA256</div>
          </div>
          <div className="vault-sec-item">
            <div className="sec-label">Inactivity Timer</div>
            <div className="sec-value">Auto-lock active (15 minutes)</div>
          </div>

          <div
            style={{
              marginTop: "1.5rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.5rem",
            }}
          >
            {activeVault && (
              <button
                type="button"
                className="btn-secondary"
                style={{ width: "100%", textAlign: "center" }}
                onClick={() => onChangePasswordClick(activeVault.id)}
              >
                Change Master Password
              </button>
            )}
            <button
              type="button"
              className="btn-secondary"
              style={{ width: "100%", textAlign: "center" }}
              onClick={onOpenGenerator}
            >
              Generate Password
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
