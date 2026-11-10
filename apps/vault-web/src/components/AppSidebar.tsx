import React from "react";
import type { DecryptedRecord } from "@pdv/data-models";

export type ActiveNavTab =
  | "dashboard"
  | "passwords"
  | "notes"
  | "identities"
  | "payments"
  | "documents"
  | "devices"
  | "recovery"
  | "settings";

interface AppSidebarProps {
  currentTab: ActiveNavTab;
  onSelectTab: (tab: ActiveNavTab) => void;
  records: DecryptedRecord[];
  isVaultUnlocked: boolean;
  onOpenCreateRecord: () => void;
  onCreateVaultClick: () => void;
  pendingDeviceCount: number;
}

export const AppSidebar: React.FC<AppSidebarProps> = ({
  currentTab,
  onSelectTab,
  records,
  isVaultUnlocked,
  onOpenCreateRecord,
  onCreateVaultClick,
  pendingDeviceCount,
}) => {
  const passwordCount = records.filter((r) => r.type === "password").length;
  const notesCount = records.filter((r) => r.type === "secure-note").length;
  const identityCount = records.filter((r) => r.type === "identity").length;
  const paymentCount = records.filter((r) => r.type === "payment").length;
  const documentCount = records.filter((r) => r.type === "document").length;

  return (
    <aside className="app-sidebar">
      <div className="sidebar-actions">
        {isVaultUnlocked ? (
          <button
            type="button"
            className="sidebar-new-btn"
            onClick={onOpenCreateRecord}
          >
            + New Item
          </button>
        ) : (
          <button
            type="button"
            className="sidebar-new-vault-btn"
            onClick={onCreateVaultClick}
          >
            + New Vault
          </button>
        )}
      </div>

      <nav className="sidebar-nav">
        <div className="sidebar-section-title">VAULT ITEMS</div>

        <button
          type="button"
          className={`sidebar-nav-item ${currentTab === "dashboard" ? "active" : ""}`}
          onClick={() => onSelectTab("dashboard")}
        >
          <span className="nav-icon">📊</span>
          <span className="nav-label">Dashboard</span>
        </button>

        <button
          type="button"
          className={`sidebar-nav-item ${currentTab === "passwords" ? "active" : ""}`}
          onClick={() => onSelectTab("passwords")}
        >
          <span className="nav-icon">🔑</span>
          <span className="nav-label">Passwords</span>
          {isVaultUnlocked && passwordCount > 0 && (
            <span className="nav-count">{passwordCount}</span>
          )}
        </button>

        <button
          type="button"
          className={`sidebar-nav-item ${currentTab === "notes" ? "active" : ""}`}
          onClick={() => onSelectTab("notes")}
        >
          <span className="nav-icon">📝</span>
          <span className="nav-label">Secure Notes</span>
          {isVaultUnlocked && notesCount > 0 && (
            <span className="nav-count">{notesCount}</span>
          )}
        </button>

        <button
          type="button"
          className={`sidebar-nav-item ${currentTab === "identities" ? "active" : ""}`}
          onClick={() => onSelectTab("identities")}
        >
          <span className="nav-icon">🪪</span>
          <span className="nav-label">Identities</span>
          {isVaultUnlocked && identityCount > 0 && (
            <span className="nav-count">{identityCount}</span>
          )}
        </button>

        <button
          type="button"
          className={`sidebar-nav-item ${currentTab === "payments" ? "active" : ""}`}
          onClick={() => onSelectTab("payments")}
        >
          <span className="nav-icon">💳</span>
          <span className="nav-label">Payment Cards</span>
          {isVaultUnlocked && paymentCount > 0 && (
            <span className="nav-count">{paymentCount}</span>
          )}
        </button>

        <button
          type="button"
          className={`sidebar-nav-item ${currentTab === "documents" ? "active" : ""}`}
          onClick={() => onSelectTab("documents")}
        >
          <span className="nav-icon">📁</span>
          <span className="nav-label">Documents</span>
          {isVaultUnlocked && documentCount > 0 && (
            <span className="nav-count">{documentCount}</span>
          )}
        </button>

        <div className="sidebar-section-title" style={{ marginTop: "1.5rem" }}>
          SYSTEM & SECURITY
        </div>

        <button
          type="button"
          className={`sidebar-nav-item ${currentTab === "devices" ? "active" : ""}`}
          onClick={() => onSelectTab("devices")}
        >
          <span className="nav-icon">📱</span>
          <span className="nav-label">Devices</span>
          {pendingDeviceCount > 0 && (
            <span className="nav-count-alert">{pendingDeviceCount}</span>
          )}
        </button>

        <button
          type="button"
          className={`sidebar-nav-item ${currentTab === "recovery" ? "active" : ""}`}
          onClick={() => onSelectTab("recovery")}
        >
          <span className="nav-icon">🛡️</span>
          <span className="nav-label">Backup & Recovery</span>
        </button>

        <button
          type="button"
          className={`sidebar-nav-item ${currentTab === "settings" ? "active" : ""}`}
          onClick={() => onSelectTab("settings")}
        >
          <span className="nav-icon">⚙️</span>
          <span className="nav-label">Settings</span>
        </button>
      </nav>

      <div className="sidebar-footer-info">
        <div className="security-status-indicator">
          <span className="status-dot"></span>
          <span>Zero-Knowledge Active</span>
        </div>
        <div className="offline-ready-tag">Offline-First IndexedDB</div>
      </div>
    </aside>
  );
};
