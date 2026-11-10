import React, { useState } from "react";
import { estimatePasswordStrength } from "../../storage/password-generator";

interface CreateVaultModalProps {
  onCreate: (password: string) => Promise<string | null>;
  onClose: () => void;
}

export const CreateVaultModal: React.FC<CreateVaultModalProps> = ({
  onCreate,
  onClose,
}) => {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [derivingStatus, setDerivingStatus] = useState<string | null>(null);

  const strength = estimatePasswordStrength(password);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setError("Master password must be at least 8 characters");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    try {
      setIsCreating(true);
      setError(null);
      setDerivingStatus(
        "Deriving Argon2id (p=4, m=64MB, t=3) key & sealing envelopes...",
      );
      const recoverySecret = await onCreate(password);
      if (recoverySecret) {
        setCreatedSecret(recoverySecret);
      } else {
        onClose();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create vault");
    } finally {
      setIsCreating(false);
      setDerivingStatus(null);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <h3>Create New Encrypted Vault</h3>
          {!createdSecret && (
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={isCreating}
            >
              ✕
            </button>
          )}
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        {createdSecret ? (
          <div>
            <div className="warning-banner" style={{ marginBottom: "1rem" }}>
              <strong>⚠️ Vault Recovery Secret Generated</strong>
              <p style={{ margin: "0.25rem 0 0" }}>
                Write down or copy this 256-bit recovery secret and store it in
                an offline location.
                <em>
                  {" "}
                  If both your password and recovery secret are lost, your vault
                  data cannot be recovered by anyone.
                </em>
              </p>
            </div>

            <div
              className="secret-display font-mono"
              style={{ textAlign: "center", fontSize: "1.1rem" }}
            >
              {createdSecret}
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn-primary"
                style={{ width: "100%" }}
                onClick={onClose}
              >
                I Have Safely Saved My Recovery Secret
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <p
              style={{
                fontSize: "0.85rem",
                color: "#556b5a",
                margin: "0 0 1rem",
              }}
            >
              Your master password derives your Vault Encryption Key (VEK) using
              the proposed Argon2id v1.3 parameters (parallelism = 4, memory =
              64 MiB, iterations = 3).
            </p>

            <div className="form-group">
              <label>Master Password *</label>
              <input
                type="password"
                className="form-control"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={isCreating}
              />
              {password && (
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
              <label>Confirm Master Password *</label>
              <input
                type="password"
                className="form-control"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={isCreating}
              />
            </div>

            {derivingStatus && (
              <div className="alert alert-info">
                <span>⏳ {derivingStatus}</span>
              </div>
            )}

            <div className="modal-footer">
              <button
                type="button"
                className="btn-secondary"
                onClick={onClose}
                disabled={isCreating}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={isCreating}
              >
                {isCreating ? "Deriving & Sealing..." : "Create Vault"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
