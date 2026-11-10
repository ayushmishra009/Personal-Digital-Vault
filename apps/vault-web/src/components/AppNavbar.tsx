import React from "react";
import type { AccountSession, VaultMetadata } from "../api";

interface AppNavbarProps {
  session: AccountSession;
  vaults: VaultMetadata[];
  activeVaultId: string | null;
  unlockedKeys: Record<string, CryptoKey>;
  onSelectVault: (vaultId: string) => void;
  onCreateVaultClick: () => void;
  onLockVault: (vaultId: string) => void;
  onUnlockVaultClick: (vaultId: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onOpenGenerator: () => void;
  onLogout: () => void;
  syncStatus?: "idle" | "syncing" | "offline" | "conflict";
  pendingOpsCount?: number;
  onSyncClick?: () => void;
}

export const AppNavbar: React.FC<AppNavbarProps> = ({
  session,
  vaults,
  activeVaultId,
  unlockedKeys,
  onSelectVault,
  onCreateVaultClick,
  onLockVault,
  onUnlockVaultClick,
  searchQuery,
  onSearchChange,
  onOpenGenerator,
  onLogout,
  syncStatus = "idle",
  pendingOpsCount = 0,
  onSyncClick,
}) => {
  const activeVault = vaults.find((v) => v.id === activeVaultId);
  const isUnlocked = activeVaultId ? !!unlockedKeys[activeVaultId] : false;

  return (
    <header className="app-navbar">
      <div className="navbar-left">
        <div className="navbar-brand">
          <span className="brand-icon">🛡️</span>
          <span className="brand-name">Personal Digital Vault</span>
        </div>

        {/* Vault Selector */}
        {vaults.length > 0 ? (
          <div className="vault-selector-container">
            <select
              className="vault-select"
              value={activeVaultId || ""}
              onChange={(e) => onSelectVault(e.target.value)}
            >
              {vaults.map((v, i) => {
                const unlocked = !!unlockedKeys[v.id];
                return (
                  <option key={v.id} value={v.id}>
                    {unlocked ? "🔓" : "🔒"} Vault #{i + 1} ({v.id.slice(0, 8)}
                    ...)
                  </option>
                );
              })}
            </select>

            {activeVault && (
              <div className="vault-status-actions">
                {isUnlocked ? (
                  <button
                    type="button"
                    className="btn-navbar-lock"
                    onClick={() => onLockVault(activeVault.id)}
                    title="Lock vault immediately"
                  >
                    🔒 Lock
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-navbar-unlock"
                    onClick={() => onUnlockVaultClick(activeVault.id)}
                  >
                    🔓 Unlock
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <button
            type="button"
            className="btn-navbar-primary"
            onClick={onCreateVaultClick}
          >
            + Create First Vault
          </button>
        )}
      </div>

      <div className="navbar-center">
        <div className="global-search-box">
          <span className="search-icon">🔍</span>
          <input
            type="search"
            placeholder="Search passwords, notes, identities..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="global-search-input"
          />
          {searchQuery && (
            <button
              type="button"
              className="search-clear-btn"
              onClick={() => onSearchChange("")}
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="navbar-right">
        {onSyncClick && (
          <button
            type="button"
            className={`btn-navbar-sync ${syncStatus}`}
            onClick={onSyncClick}
            disabled={syncStatus === "syncing"}
            title="Synchronize vault with backend"
          >
            {syncStatus === "syncing" && "🔄 Syncing..."}
            {syncStatus === "conflict" && "⚠️ Conflict"}
            {syncStatus === "offline" && "📡 Offline"}
            {syncStatus === "idle" &&
              (pendingOpsCount > 0
                ? `☁️ (${pendingOpsCount} pending)`
                : "☁️ Synced")}
          </button>
        )}

        <button
          type="button"
          className="btn-navbar-secondary"
          onClick={onOpenGenerator}
          title="Open Password Generator"
        >
          ⚡ Generator
        </button>

        <span className="timer-badge">⏱️ Auto-lock in 15m</span>

        <div className="user-profile-badge">
          <span className="user-email">{session.account.email}</span>
        </div>

        <button
          type="button"
          className="btn-navbar-logout"
          onClick={onLogout}
          title="Sign Out"
        >
          Sign Out
        </button>
      </div>
    </header>
  );
};
