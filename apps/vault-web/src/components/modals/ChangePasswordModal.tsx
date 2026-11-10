import React, { useState } from "react";
import { estimatePasswordStrength } from "../../storage/password-generator";

interface ChangePasswordModalProps {
  vaultId: string;
  onChangePassword: (currentPw: string, newPw: string) => Promise<void>;
  onClose: () => void;
}

export const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({
  vaultId,
  onChangePassword,
  onClose,
}) => {
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmNewPw, setConfirmNewPw] = useState("");
  const [isChanging, setIsChanging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const strength = estimatePasswordStrength(newPw);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPw) {
      setError("Current password is required");
      return;
    }
    if (newPw.length < 8) {
      setError("New password must be at least 8 characters");
      return;
    }
    if (newPw !== confirmNewPw) {
      setError("New passwords do not match");
      return;
    }

    try {
      setIsChanging(true);
      setError(null);
      setStatusMsg(
        "Deriving keys and rewrapping Vault Encryption Key (VEK)...",
      );
      await onChangePassword(currentPw, newPw);
      onClose();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to change master password",
      );
    } finally {
      setIsChanging(false);
      setStatusMsg(null);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h3>Change Master Password ({vaultId.slice(0, 8)}...)</h3>
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={isChanging}
          >
            ✕
          </button>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        <p
          style={{ fontSize: "0.85rem", color: "#556b5a", margin: "0 0 1rem" }}
        >
          Rewraps your existing Vault Encryption Key with fresh salt using
          proposed Argon2id parameters. Your encrypted records and recovery
          secret remain untouched.
        </p>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Current Master Password *</label>
            <input
              type="password"
              className="form-control"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              required
              disabled={isChanging}
            />
          </div>

          <div className="form-group">
            <label>New Master Password *</label>
            <input
              type="password"
              className="form-control"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              required
              disabled={isChanging}
            />
            {newPw && (
              <div style={{ marginTop: "0.4rem" }}>
                <div className="strength-bar">
                  <div
                    className="strength-fill"
                    style={{
                      width: `${Math.min(100, (strength.entropyBits / 90) * 100)}%`,
                      backgroundColor: strength.color,
                    }}
                  />
                </div>
                <div
                  style={{
                    fontSize: "0.75rem",
                    color: "#556b5a",
                    marginTop: "0.2rem",
                  }}
                >
                  Strength:{" "}
                  <strong style={{ color: strength.color }}>
                    {strength.label}
                  </strong>
                </div>
              </div>
            )}
          </div>

          <div className="form-group">
            <label>Confirm New Master Password *</label>
            <input
              type="password"
              className="form-control"
              value={confirmNewPw}
              onChange={(e) => setConfirmNewPw(e.target.value)}
              required
              disabled={isChanging}
            />
          </div>

          {statusMsg && (
            <div className="alert alert-info">
              <span>⏳ {statusMsg}</span>
            </div>
          )}

          <div className="modal-footer">
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={isChanging}
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={isChanging}>
              {isChanging ? "Rewrapping VEK..." : "Update Master Password"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
