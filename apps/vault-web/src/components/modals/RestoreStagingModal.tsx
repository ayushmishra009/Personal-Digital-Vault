import React, { useState } from "react";
import type { StagedRestorePlan, RestoreRecordStatus } from "@pdv/data-models";

export interface RestoreStagingModalProps {
  plan: StagedRestorePlan;
  onConfirmRestore: (options: {
    overwriteConflicts: boolean;
    selectedObjectIds?: string[];
  }) => Promise<void>;
  onClose: () => void;
}

export const RestoreStagingModal: React.FC<RestoreStagingModalProps> = ({
  plan,
  onConfirmRestore,
  onClose,
}) => {
  const [overwriteConflicts, setOverwriteConflicts] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    for (const item of plan.items) {
      if (item.status !== "identical") {
        initial.add(item.objectId);
      }
    }
    return initial;
  });
  const [isApplying, setIsApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === plan.items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(plan.items.map((i) => i.objectId)));
    }
  };

  const handleConfirm = async () => {
    setIsApplying(true);
    setError(null);
    try {
      await onConfirmRestore({
        overwriteConflicts,
        selectedObjectIds: Array.from(selectedIds),
      });
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to restore backup archive",
      );
    } finally {
      setIsApplying(false);
    }
  };

  const renderStatusBadge = (status: RestoreRecordStatus) => {
    switch (status) {
      case "new":
        return (
          <span
            style={{
              padding: "0.2rem 0.5rem",
              borderRadius: "4px",
              fontSize: "0.75rem",
              backgroundColor: "#dcfce7",
              color: "#166534",
              fontWeight: 600,
            }}
          >
            New
          </span>
        );
      case "upgraded":
        return (
          <span
            style={{
              padding: "0.2rem 0.5rem",
              borderRadius: "4px",
              fontSize: "0.75rem",
              backgroundColor: "#dbeafe",
              color: "#1e40af",
              fontWeight: 600,
            }}
          >
            Update
          </span>
        );
      case "identical":
        return (
          <span
            style={{
              padding: "0.2rem 0.5rem",
              borderRadius: "4px",
              fontSize: "0.75rem",
              backgroundColor: "#f3f4f6",
              color: "#4b5563",
              fontWeight: 600,
            }}
          >
            Identical
          </span>
        );
      case "conflict_older":
        return (
          <span
            style={{
              padding: "0.2rem 0.5rem",
              borderRadius: "4px",
              fontSize: "0.75rem",
              backgroundColor: "#fee2e2",
              color: "#991b1b",
              fontWeight: 600,
            }}
          >
            Older Conflict
          </span>
        );
      case "conflict_divergent":
        return (
          <span
            style={{
              padding: "0.2rem 0.5rem",
              borderRadius: "4px",
              fontSize: "0.75rem",
              backgroundColor: "#fef3c7",
              color: "#92400e",
              fontWeight: 600,
            }}
          >
            Divergent Conflict
          </span>
        );
    }
  };

  return (
    <div className="modal-backdrop">
      <div
        className="modal-content"
        style={{ maxWidth: "780px", width: "95%" }}
      >
        <div className="modal-header">
          <div>
            <h3 style={{ margin: 0 }}>Review Backup Restore Staging</h3>
            <p
              style={{
                fontSize: "0.82rem",
                color: "#6b7280",
                margin: "0.25rem 0 0",
              }}
            >
              Snapshot ID: <span className="font-mono">{plan.snapshotId}</span>{" "}
              | Created: {new Date(plan.createdAt).toLocaleString()}
            </p>
          </div>
          <button
            type="button"
            className="btn-icon"
            onClick={onClose}
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <div
          className="modal-body"
          style={{ maxHeight: "65vh", overflowY: "auto" }}
        >
          {error && (
            <div
              className="alert alert-danger"
              style={{ marginBottom: "1rem" }}
            >
              {error}
            </div>
          )}

          {/* Staging Summary Badges */}
          <div
            style={{
              display: "flex",
              gap: "0.75rem",
              marginBottom: "1rem",
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                padding: "0.5rem 0.75rem",
                borderRadius: "6px",
                border: "1px solid #bbf7d0",
                backgroundColor: "#f0fdf4",
                fontSize: "0.85rem",
              }}
            >
              <strong>{plan.summary.newCount}</strong> New Records
            </div>
            <div
              style={{
                padding: "0.5rem 0.75rem",
                borderRadius: "6px",
                border: "1px solid #bfdbfe",
                backgroundColor: "#eff6ff",
                fontSize: "0.85rem",
              }}
            >
              <strong>{plan.summary.upgradedCount}</strong> Upgrades
            </div>
            <div
              style={{
                padding: "0.5rem 0.75rem",
                borderRadius: "6px",
                border: "1px solid #e5e7eb",
                backgroundColor: "#f9fafb",
                fontSize: "0.85rem",
              }}
            >
              <strong>{plan.summary.identicalCount}</strong> Identical
            </div>
            {plan.summary.conflictCount > 0 && (
              <div
                style={{
                  padding: "0.5rem 0.75rem",
                  borderRadius: "6px",
                  border: "1px solid #fecaca",
                  backgroundColor: "#fef2f2",
                  color: "#991b1b",
                  fontSize: "0.85rem",
                }}
              >
                <strong>{plan.summary.conflictCount}</strong> Conflicts
              </div>
            )}
            {plan.attachments.length > 0 && (
              <div
                style={{
                  padding: "0.5rem 0.75rem",
                  borderRadius: "6px",
                  border: "1px solid #e5e7eb",
                  backgroundColor: "#f9fafb",
                  fontSize: "0.85rem",
                }}
              >
                <strong>{plan.attachments.length}</strong> Attachments
              </div>
            )}
          </div>

          {/* Conflict Safeguard Warning Banner */}
          {plan.summary.conflictCount > 0 && (
            <div
              className="warning-banner"
              style={{
                marginBottom: "1rem",
                padding: "0.75rem 1rem",
                border: "1px solid #fed7aa",
                backgroundColor: "#fff7ed",
                borderRadius: "6px",
              }}
            >
              <strong style={{ color: "#9a3412" }}>
                ⚠️ Restore Conflict Safeguard:
              </strong>
              <p
                style={{
                  margin: "0.25rem 0 0.5rem",
                  fontSize: "0.82rem",
                  color: "#7c2d12",
                }}
              >
                {plan.summary.conflictCount} record(s) in this archive have an
                older revision than what is currently stored in your local
                database. By default, older revisions are protected and will not
                silently overwrite your newer data.
              </p>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  fontSize: "0.82rem",
                  color: "#991b1b",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={overwriteConflicts}
                  onChange={(e) => setOverwriteConflicts(e.target.checked)}
                />
                Force overwrite newer local records with older backup versions
              </label>
            </div>
          )}

          {/* Staged Records Table */}
          <table
            className="data-table"
            style={{
              width: "100%",
              fontSize: "0.85rem",
              borderCollapse: "collapse",
            }}
          >
            <thead>
              <tr
                style={{ borderBottom: "2px solid #e5e7eb", textAlign: "left" }}
              >
                <th style={{ padding: "0.5rem" }}>
                  <input
                    type="checkbox"
                    checked={
                      selectedIds.size === plan.items.length &&
                      plan.items.length > 0
                    }
                    onChange={toggleSelectAll}
                    aria-label="Select all records"
                  />
                </th>
                <th style={{ padding: "0.5rem" }}>Title</th>
                <th style={{ padding: "0.5rem" }}>Type</th>
                <th style={{ padding: "0.5rem" }}>Backup Rev</th>
                <th style={{ padding: "0.5rem" }}>Local Rev</th>
                <th style={{ padding: "0.5rem" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {plan.items.map((item) => (
                <tr
                  key={item.objectId}
                  style={{
                    borderBottom: "1px solid #f3f4f6",
                    backgroundColor: selectedIds.has(item.objectId)
                      ? undefined
                      : "#fafafa",
                  }}
                >
                  <td style={{ padding: "0.5rem" }}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.objectId)}
                      onChange={() => toggleSelect(item.objectId)}
                      aria-label={`Select ${item.title}`}
                    />
                  </td>
                  <td style={{ padding: "0.5rem", fontWeight: 500 }}>
                    {item.title}
                  </td>
                  <td style={{ padding: "0.5rem", color: "#6b7280" }}>
                    {item.type}
                  </td>
                  <td style={{ padding: "0.5rem" }}>v{item.backupRevision}</td>
                  <td style={{ padding: "0.5rem", color: "#6b7280" }}>
                    {item.localRevision !== undefined
                      ? `v${item.localRevision}`
                      : "—"}
                  </td>
                  <td style={{ padding: "0.5rem" }}>
                    {renderStatusBadge(item.status)}
                  </td>
                </tr>
              ))}
              {plan.items.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    style={{
                      padding: "1.5rem",
                      textAlign: "center",
                      color: "#6b7280",
                    }}
                  >
                    No records found in this backup archive.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div
          className="modal-footer"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: "1.25rem",
          }}
        >
          <div style={{ fontSize: "0.82rem", color: "#6b7280" }}>
            {selectedIds.size} of {plan.items.length} record(s) selected
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={isApplying}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleConfirm}
              disabled={isApplying || selectedIds.size === 0}
            >
              {isApplying
                ? "Applying..."
                : `Confirm Restore (${selectedIds.size} items)`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
