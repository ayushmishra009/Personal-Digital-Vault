import React, { useState } from "react";
import type { DecryptedRecord } from "@pdv/data-models";
import type { ActiveConflict } from "../../storage/sync-engine";

interface ConflictResolutionModalProps {
  conflict: ActiveConflict;
  onKeepLocal: () => Promise<void>;
  onKeepRemote: () => Promise<void>;
  onMerge: (mergedRecord: DecryptedRecord) => Promise<void>;
  onClose: () => void;
}

export const ConflictResolutionModal: React.FC<
  ConflictResolutionModalProps
> = ({ conflict, onKeepLocal, onKeepRemote, onMerge, onClose }) => {
  const [isMerging, setIsMerging] = useState(false);
  const [mergedTitle, setMergedTitle] = useState(
    conflict.localRecord?.title || conflict.remoteRecord?.title || "",
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const local = conflict.localRecord;
  const remote = conflict.remoteRecord;

  const handleKeepLocal = async () => {
    setLoading(true);
    try {
      await onKeepLocal();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to keep local version",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleKeepRemote = async () => {
    setLoading(true);
    try {
      await onKeepRemote();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to accept remote version",
      );
    } finally {
      setLoading(false);
    }
  };

  const handleSaveMerge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!local) return;
    setLoading(true);
    try {
      const merged: DecryptedRecord = {
        ...local,
        title: mergedTitle.trim() || local.title,
        updatedAt: new Date().toISOString(),
      };
      await onMerge(merged);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to save merged version",
      );
    } finally {
      setLoading(false);
    }
  };

  const renderRecordPreview = (
    rec: DecryptedRecord | null | undefined,
    rev: number,
  ) => {
    if (!rec) {
      return (
        <div className="conflict-card empty">
          <p style={{ color: "var(--text-muted)", fontStyle: "italic" }}>
            Record was deleted or unavailable (Revision {rev})
          </p>
        </div>
      );
    }

    return (
      <div className="conflict-card">
        <div className="conflict-field">
          <strong>Title:</strong> <span>{rec.title}</span>
        </div>
        <div className="conflict-field">
          <strong>Type:</strong> <code>{rec.type}</code>
        </div>
        <div className="conflict-field">
          <strong>Tags:</strong>{" "}
          <span>{rec.tags.length > 0 ? rec.tags.join(", ") : "None"}</span>
        </div>

        {rec.type === "password" && (
          <>
            <div className="conflict-field">
              <strong>Username:</strong> <span>{rec.username || "—"}</span>
            </div>
            <div className="conflict-field">
              <strong>Password:</strong>{" "}
              <span className="font-mono">
                {rec.password ? "••••••••••••" : "—"}
              </span>
            </div>
            {rec.url && (
              <div className="conflict-field">
                <strong>URL:</strong> <span>{rec.url}</span>
              </div>
            )}
          </>
        )}

        {rec.type === "secure-note" && (
          <div className="conflict-field">
            <strong>Content:</strong>
            <pre className="conflict-pre">{rec.content || "(empty note)"}</pre>
          </div>
        )}

        {rec.type === "identity" && (
          <div className="conflict-field">
            <strong>Fields:</strong>
            <pre className="conflict-pre">
              {JSON.stringify(rec.fields, null, 2)}
            </pre>
          </div>
        )}

        {rec.type === "payment" && (
          <div className="conflict-field">
            <strong>Cardholder:</strong>{" "}
            <span>{String(rec.fields?.cardholderName || "—")}</span>
          </div>
        )}

        <div className="conflict-field">
          <small style={{ color: "var(--text-muted)" }}>
            Updated: {new Date(rec.updatedAt).toLocaleString()}
          </small>
        </div>
      </div>
    );
  };

  return (
    <div className="modal-overlay">
      <div className="modal-card modal-lg">
        <div className="modal-header">
          <div>
            <h3
              style={{ margin: 0, color: "var(--xai-accent-sunset, #ff7a17)" }}
            >
              ⚠️ Revision Conflict Detected
            </h3>
            <p className="modal-subtitle">
              Object <code>{conflict.objectId.slice(0, 8)}...</code> was
              modified on another device.
            </p>
          </div>
          <button className="btn-close" onClick={onClose} disabled={loading}>
            ✕
          </button>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        <div
          className="alert alert-info"
          style={{ marginBottom: "1rem", fontSize: "0.85rem" }}
        >
          <strong>Zero-Knowledge Safety Guarantee:</strong> Personal Digital
          Vault never silently overwrites your data. Please inspect the
          differences below and choose which version to preserve.
        </div>

        {!isMerging ? (
          <>
            <div className="conflict-comparison-grid">
              <div className="conflict-column">
                <div className="conflict-column-header">
                  <h4>Your Local Version</h4>
                  <span className="badge badge-info">
                    Base Rev {conflict.localRevision}
                  </span>
                </div>
                {renderRecordPreview(local, conflict.localRevision)}
                <button
                  className="btn btn-primary"
                  style={{ width: "100%", marginTop: "1rem" }}
                  onClick={handleKeepLocal}
                  disabled={loading || !local}
                >
                  Keep My Local Version
                </button>
              </div>

              <div className="conflict-column">
                <div className="conflict-column-header">
                  <h4>Remote Server Version</h4>
                  <span className="badge badge-warning">
                    Server Rev {conflict.remoteRevision}
                  </span>
                </div>
                {renderRecordPreview(remote, conflict.remoteRevision)}
                <button
                  className="btn btn-secondary"
                  style={{ width: "100%", marginTop: "1rem" }}
                  onClick={handleKeepRemote}
                  disabled={loading}
                >
                  Accept Server Version
                </button>
              </div>
            </div>

            <div
              style={{
                marginTop: "1.5rem",
                textAlign: "center",
                borderTop: "1px solid var(--border-color)",
                paddingTop: "1rem",
              }}
            >
              <button
                className="btn btn-ghost"
                onClick={() => setIsMerging(true)}
                disabled={loading || !local}
              >
                ✏️ Manually Merge Versions
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSaveMerge}>
            <h4>Manual Merge</h4>
            <div className="form-group" style={{ marginBottom: "1rem" }}>
              <label>Merged Title</label>
              <input
                type="text"
                className="form-control"
                value={mergedTitle}
                onChange={(e) => setMergedTitle(e.target.value)}
                required
              />
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setIsMerging(false)}
                disabled={loading}
              >
                Back to Comparison
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading}
              >
                Save Merged Version
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
