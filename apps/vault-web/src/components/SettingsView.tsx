import React, { useState } from "react";
import type { AccountSession } from "../api";
import type { CmsThemeSettings } from "@pdv/data-models";

interface SettingsViewProps {
  session: AccountSession;
  theme: CmsThemeSettings;
  onUpdateTheme: (theme: CmsThemeSettings) => void;
  inactivityTimeoutMinutes: number;
  onChangeInactivityTimeout: (mins: number) => void;
  onClearLocalCache: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  session,
  theme,
  onUpdateTheme,
  inactivityTimeoutMinutes,
  onChangeInactivityTimeout,
  onClearLocalCache,
}) => {
  const [localTheme, setLocalTheme] = useState<CmsThemeSettings>(theme);

  const handlePresetChange = (preset: string) => {
    let color = localTheme.primaryColor;
    if (preset === "emerald") color = "#10b981";
    if (preset === "midnight") color = "#3b82f6";
    if (preset === "nordic") color = "#0284c7";
    if (preset === "slate") color = "#475569";
    if (preset === "default") color = "#1c5230";

    const updated = { ...localTheme, themePreset: preset, primaryColor: color };
    setLocalTheme(updated);
    onUpdateTheme(updated);
  };

  const handleColorChange = (color: string) => {
    const updated = { ...localTheme, primaryColor: color };
    setLocalTheme(updated);
    onUpdateTheme(updated);
  };

  const handleRadiusChange = (radius: string) => {
    const updated = { ...localTheme, borderRadius: radius };
    setLocalTheme(updated);
    onUpdateTheme(updated);
  };

  return (
    <div className="view-container">
      <div className="view-header">
        <div>
          <h2>Settings & Preferences</h2>
          <p className="view-subtitle">
            Configure security timeouts, client appearance tokens, and local
            cache storage.
          </p>
        </div>
      </div>

      <div className="settings-grid">
        {/* Account Details */}
        <div className="card">
          <h3 style={{ margin: "0 0 1rem", fontSize: "1.1rem" }}>
            Account Profile
          </h3>
          <div className="settings-item">
            <span className="field-name">Email Address</span>
            <span className="field-text font-bold">
              {session.account.email}
            </span>
          </div>
          <div className="settings-item">
            <span className="field-name">Account ID</span>
            <span className="field-text font-mono text-sm">
              {session.account.id}
            </span>
          </div>
          <div className="settings-item">
            <span className="field-name">Member Since</span>
            <span className="field-text">
              {new Date(session.account.createdAt).toLocaleDateString()}
            </span>
          </div>
          <div className="settings-item">
            <span className="field-name">Session Expiry</span>
            <span className="field-text">
              {new Date(session.expiresAt).toLocaleTimeString()}
            </span>
          </div>
        </div>

        {/* Security Preferences */}
        <div className="card">
          <h3 style={{ margin: "0 0 1rem", fontSize: "1.1rem" }}>
            Security & Hygiene
          </h3>
          <div className="form-group" style={{ marginBottom: "1.25rem" }}>
            <label style={{ fontSize: "0.85rem", fontWeight: 600 }}>
              Inactivity Auto-Lock Timeout
            </label>
            <p
              style={{
                margin: "0.2rem 0 0.5rem",
                fontSize: "0.8rem",
                color: "#556b5a",
              }}
            >
              Vault Encryption Keys (VEKs) and decrypted records are wiped from
              browser memory when idle.
            </p>
            <select
              className="form-control"
              value={inactivityTimeoutMinutes}
              onChange={(e) =>
                onChangeInactivityTimeout(parseInt(e.target.value) || 15)
              }
            >
              <option value={5}>5 minutes (High Security)</option>
              <option value={15}>15 minutes (Standard)</option>
              <option value={30}>30 minutes</option>
              <option value={60}>1 hour</option>
            </select>
          </div>

          <div className="settings-item">
            <span className="field-name">Clipboard Auto-Clear</span>
            <span className="field-text">30 seconds (Always Active)</span>
          </div>
          <div className="settings-item">
            <span className="field-name">Argon2id KDF Memory</span>
            <span className="field-text">65,536 KiB (64 MiB)</span>
          </div>
        </div>

        {/* Appearance & Design Tokens */}
        <div className="card">
          <h3 style={{ margin: "0 0 1rem", fontSize: "1.1rem" }}>
            Appearance & Branding Tokens
          </h3>
          <div className="form-group" style={{ marginBottom: "1rem" }}>
            <label style={{ fontSize: "0.85rem", fontWeight: 600 }}>
              Theme Preset
            </label>
            <select
              className="form-control"
              value={localTheme.themePreset}
              onChange={(e) => handlePresetChange(e.target.value)}
            >
              <option value="default">Default Vault (Forest Green)</option>
              <option value="emerald">Emerald Vibrant</option>
              <option value="midnight">Midnight Sapphire</option>
              <option value="nordic">Nordic Arctic Blue</option>
              <option value="slate">Monochrome Slate</option>
            </select>
          </div>

          <div className="form-group" style={{ marginBottom: "1rem" }}>
            <label style={{ fontSize: "0.85rem", fontWeight: 600 }}>
              Primary Brand Color
            </label>
            <div
              style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}
            >
              <input
                type="color"
                value={localTheme.primaryColor}
                onChange={(e) => handleColorChange(e.target.value)}
                style={{
                  width: 44,
                  height: 38,
                  border: "none",
                  cursor: "pointer",
                }}
              />
              <input
                type="text"
                className="form-control"
                value={localTheme.primaryColor}
                onChange={(e) => handleColorChange(e.target.value)}
              />
            </div>
          </div>

          <div className="form-group">
            <label style={{ fontSize: "0.85rem", fontWeight: 600 }}>
              Border Radius
            </label>
            <select
              className="form-control"
              value={localTheme.borderRadius}
              onChange={(e) => handleRadiusChange(e.target.value)}
            >
              <option value="4px">4px (Sharp)</option>
              <option value="8px">8px (Standard)</option>
              <option value="12px">12px (Smooth)</option>
              <option value="16px">16px (Rounded)</option>
            </select>
          </div>
        </div>

        {/* Local Storage Status */}
        <div className="card">
          <h3 style={{ margin: "0 0 1rem", fontSize: "1.1rem" }}>
            Local Encrypted Cache
          </h3>
          <p
            style={{
              fontSize: "0.85rem",
              color: "#556b5a",
              margin: "0 0 1rem",
            }}
          >
            Stored in <code>pdv_local_store</code> v1 IndexedDB. All objects are
            AES-256-GCM encrypted at rest.
          </p>
          <div className="settings-item">
            <span className="field-name">Engine</span>
            <span className="field-text">HTML5 IndexedDB API</span>
          </div>
          <div className="settings-item">
            <span className="field-name">Key Wrapping</span>
            <span className="field-text">AES-256-KW (NIST SP 800-38F)</span>
          </div>
          <div style={{ marginTop: "1.5rem" }}>
            <button
              type="button"
              className="btn-danger"
              style={{ width: "100%", textAlign: "center" }}
              onClick={onClearLocalCache}
            >
              Clear Local Storage Cache
            </button>
          </div>
        </div>

        {/* Data Retention & Deletion Policy */}
        <div className="card">
          <h3 style={{ margin: "0 0 1rem", fontSize: "1.1rem" }}>
            Data Retention & Deletion Policy
          </h3>
          <p
            style={{
              fontSize: "0.85rem",
              color: "#556b5a",
              margin: "0 0 1rem",
            }}
          >
            Review lifecycle policies regarding record deletion, tombstones, and
            backups.
          </p>
          <div className="settings-item">
            <span className="field-name">Sync Tombstone Window</span>
            <span className="field-text">
              30 Days (Prevents Stale Device Overwrites)
            </span>
          </div>
          <div className="settings-item">
            <span className="field-name">Soft-Deleted Vaults</span>
            <span className="field-text">
              Retained 30 Days before Server Purge
            </span>
          </div>
          <div className="settings-item">
            <span className="field-name">Offline Backups</span>
            <span className="field-text">
              Manual .pdvbackup files remain outside server deletion
            </span>
          </div>
          <div className="settings-item">
            <span className="field-name">Account Deletion</span>
            <span className="field-text">
              Cascades and deletes all server data permanently
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
