import React, { useState } from "react";
import type { VaultMetadata } from "../api";
import { unlockWithRecovery } from "../crypto";
import { getVaultKeyEnvelope } from "../api";

interface RecoveryViewProps {
  vaults: VaultMetadata[];
  activeVaultId: string | null;
  onExportBackup: () => Promise<void>;
  onImportBackup: (file: File) => Promise<void>;
}

export const RecoveryView: React.FC<RecoveryViewProps> = ({
  vaults,
  activeVaultId,
  onExportBackup,
  onImportBackup,
}) => {
  const [testSecret, setTestSecret] = useState("");
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [testSuccess, setTestSuccess] = useState<boolean | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  const activeVault = vaults.find((v) => v.id === activeVaultId);

  const handleTestSecret = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeVault || !testSecret.trim()) return;

    try {
      setIsTesting(true);
      setTestStatus(
        "Fetching recovery envelope and verifying KDF derivation...",
      );
      const recoveryEnv = await getVaultKeyEnvelope(activeVault.id, "recovery");
      const key = await unlockWithRecovery(testSecret.trim(), recoveryEnv);
      if (key) {
        setTestSuccess(true);
        setTestStatus(
          "✓ Success! Your 256-bit recovery secret is valid and unwraps your Vault Encryption Key (VEK).",
        );
      }
    } catch {
      setTestSuccess(false);
      setTestStatus(
        "✕ Error: Invalid recovery secret. This secret could not unwrap your recovery envelope.",
      );
    } finally {
      setIsTesting(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await onImportBackup(file);
      // Reset input value so re-selecting the same file triggers change
      e.target.value = "";
    }
  };

  return (
    <div className="view-container">
      <div className="view-header">
        <div>
          <h2>Backup & Emergency Recovery</h2>
          <p className="view-subtitle">
            Offline recovery secret verification, versioned encrypted archive
            export, and staging-based restore with conflict safeguards.
          </p>
        </div>
      </div>

      <div className="warning-banner" style={{ marginBottom: "1.5rem" }}>
        <strong>
          ⚠️ Absolute Zero-Knowledge Boundary & Recovery Limitations:
        </strong>
        <p style={{ margin: "0.25rem 0 0" }}>
          Your master password and recovery secret derive encryption keys
          client-side. Antigravity/PDV engineers and support staff cannot
          decrypt, reset, or bypass vault credentials under any circumstances.
          Local browser IndexedDB storage can be evicted or cleared by the
          browser; exporting encrypted portable backups is required for
          long-term safety.
        </p>
      </div>

      <div className="settings-grid">
        {/* Test Recovery Secret */}
        <div className="card">
          <h3 style={{ margin: "0 0 0.5rem", fontSize: "1.1rem" }}>
            Verify Emergency Recovery Secret
          </h3>
          <p
            style={{
              fontSize: "0.85rem",
              color: "#556b5a",
              margin: "0 0 1rem",
            }}
          >
            Test whether your written or stored 256-bit recovery secret matches
            the active vault without logging out.
          </p>

          <form onSubmit={handleTestSecret}>
            <div className="form-group">
              <label>256-bit Recovery Secret (Base64url)</label>
              <input
                type="text"
                className="form-control font-mono"
                placeholder="43-character base64url secret"
                value={testSecret}
                onChange={(e) => setTestSecret(e.target.value)}
                required
              />
            </div>

            <button
              type="submit"
              className="btn-primary"
              disabled={isTesting || !activeVault}
              style={{ marginTop: "0.5rem" }}
            >
              {isTesting ? "Verifying..." : "Verify Secret Locally"}
            </button>
          </form>

          {testStatus && (
            <div
              className={`alert ${testSuccess ? "alert-success" : "alert-danger"}`}
              style={{ marginTop: "1rem" }}
            >
              {testStatus}
            </div>
          )}
        </div>

        {/* Encrypted Portable Backup Archive */}
        <div className="card">
          <h3 style={{ margin: "0 0 0.5rem", fontSize: "1.1rem" }}>
            Encrypted Backup Archive
          </h3>
          <p
            style={{
              fontSize: "0.85rem",
              color: "#556b5a",
              margin: "0 0 1.25rem",
            }}
          >
            Export or restore an authenticated, versioned backup archive
            (.pdvbackup). Contains all encrypted records, attachments, key
            envelopes, and an integrity manifest verified prior to restoration.
          </p>

          <div
            style={{ display: "flex", flexDirection: "column", gap: "1rem" }}
          >
            <div>
              <button
                type="button"
                className="btn-secondary"
                style={{ width: "100%", padding: "0.6rem" }}
                onClick={onExportBackup}
                disabled={!activeVault}
              >
                📥 Export Encrypted JSON Archive (.pdvbackup)
              </button>
              <div
                style={{
                  fontSize: "0.78rem",
                  color: "#6b7280",
                  marginTop: "0.25rem",
                }}
              >
                Exports authenticated package (AES-256-GCM + HKDF) with
                integrity manifest.
              </div>
            </div>

            <div style={{ borderTop: "1px solid #edf2ee", paddingTop: "1rem" }}>
              <label
                className="btn-secondary"
                style={{
                  display: "block",
                  textAlign: "center",
                  cursor: "pointer",
                  padding: "0.6rem",
                }}
              >
                📤 Import Encrypted JSON Archive / Restore Backup
                <input
                  type="file"
                  accept=".pdvbackup,.json,application/json"
                  onChange={handleFileChange}
                  style={{ display: "none" }}
                />
              </label>
              <div
                style={{
                  fontSize: "0.78rem",
                  color: "#6b7280",
                  marginTop: "0.25rem",
                }}
              >
                Validates integrity manifest and opens review staging modal
                before writing.
              </div>
            </div>

            <div
              style={{
                marginTop: "0.5rem",
                padding: "0.6rem",
                backgroundColor: "#f9fafb",
                borderRadius: "4px",
                border: "1px solid #e5e7eb",
                fontSize: "0.74rem",
                color: "#6b7280",
              }}
            >
              <strong>🔒 Metadata Disclosure:</strong> The backend tracks
              snapshot ID, creation timestamp, and ciphertext size for
              compliance and sync cursors. Ciphertext contents, records, and
              encryption keys never leave the client.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
