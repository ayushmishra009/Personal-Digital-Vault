import React, { useState } from "react";

interface UnlockVaultModalProps {
  vaultId: string;
  onUnlockPassword: (vaultId: string, password: string) => Promise<void>;
  onUnlockRecovery: (vaultId: string, secret: string) => Promise<void>;
  onClose: () => void;
}

export const UnlockVaultModal: React.FC<UnlockVaultModalProps> = ({
  vaultId,
  onUnlockPassword,
  onUnlockRecovery,
  onClose,
}) => {
  const [mode, setMode] = useState<"password" | "recovery">("password");
  const [inputVal, setInputVal] = useState("");
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [derivingStatus, setDerivingStatus] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputVal.trim()) return;

    try {
      setIsUnlocking(true);
      setError(null);
      if (mode === "password") {
        setDerivingStatus(
          "Deriving Argon2id (p=4, m=64MB, t=3) and opening envelope...",
        );
        await onUnlockPassword(vaultId, inputVal);
      } else {
        setDerivingStatus(
          "Verifying 256-bit recovery secret and opening recovery envelope...",
        );
        await onUnlockRecovery(vaultId, inputVal.trim());
      }
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to unlock vault");
    } finally {
      setIsUnlocking(false);
      setDerivingStatus(null);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <h3>Unlock Vault ({vaultId.slice(0, 8)}...)</h3>
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={isUnlocking}
          >
            ✕
          </button>
        </div>

        <div className="tab-bar" style={{ marginBottom: "1rem" }}>
          <button
            type="button"
            className={`tab-btn ${mode === "password" ? "active" : ""}`}
            onClick={() => {
              setMode("password");
              setError(null);
            }}
          >
            Master Password
          </button>
          <button
            type="button"
            className={`tab-btn ${mode === "recovery" ? "active" : ""}`}
            onClick={() => {
              setMode("recovery");
              setError(null);
            }}
          >
            Recovery Secret
          </button>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        <form onSubmit={handleSubmit}>
          {mode === "password" ? (
            <div className="form-group">
              <label>Master Password</label>
              <input
                type="password"
                className="form-control"
                placeholder="Enter your master password"
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                autoFocus
                required
                disabled={isUnlocking}
              />
            </div>
          ) : (
            <div className="form-group">
              <label>256-bit Recovery Secret (Base64url)</label>
              <input
                type="text"
                className="form-control font-mono"
                placeholder="43-character base64url secret"
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                autoFocus
                required
                disabled={isUnlocking}
              />
            </div>
          )}

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
              disabled={isUnlocking}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary"
              disabled={isUnlocking}
            >
              {isUnlocking ? "Unlocking..." : "Unlock Vault"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
