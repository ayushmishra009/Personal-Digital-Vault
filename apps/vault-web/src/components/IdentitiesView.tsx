import React, { useState } from "react";
import type { IdentityRecord } from "@pdv/data-models";

interface IdentitiesViewProps {
  records: IdentityRecord[];
  onOpenCreate: () => void;
  onOpenEdit: (record: IdentityRecord) => void;
  onDelete: (record: IdentityRecord) => void;
  onCopy: (text: string, label: string) => void;
}

export const IdentitiesView: React.FC<IdentitiesViewProps> = ({
  records,
  onOpenCreate,
  onOpenEdit,
  onDelete,
  onCopy,
}) => {
  const [revealedIds, setRevealedIds] = useState<Record<string, boolean>>({});

  const toggleReveal = (id: string) => {
    setRevealedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="view-container">
      <div className="view-header">
        <div>
          <h2>Identities ({records.length})</h2>
          <p className="view-subtitle">
            Passports, driver's licenses, social security numbers, and personal
            identity documents.
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={onOpenCreate}>
          + Add Identity
        </button>
      </div>

      {records.length > 0 ? (
        <div className="records-grid">
          {records.map((record) => {
            const isRevealed = !!revealedIds[record.id];
            const idType = String(record.fields["idType"] || "Identity");
            const fullName = String(record.fields["fullName"] || "");
            const docNumber = String(record.fields["documentNumber"] || "");
            const country = String(record.fields["issuingCountry"] || "");
            const expiry = String(record.fields["expiryDate"] || "");
            const notes = String(record.fields["notes"] || "");

            return (
              <div key={record.id} className="card identity-card">
                <div className="identity-card-header">
                  <div>
                    <span className="badge badge-screen">{idType}</span>
                    <h3
                      style={{ margin: "0.4rem 0 0.1rem", fontSize: "1.15rem" }}
                    >
                      {record.title}
                    </h3>
                    {fullName && (
                      <div
                        style={{
                          fontSize: "0.85rem",
                          color: "var(--xai-mute, #7d8187)",
                        }}
                      >
                        {fullName}
                      </div>
                    )}
                  </div>
                  <div className="record-card-actions">
                    <button
                      type="button"
                      className="btn-icon"
                      title="Edit Identity"
                      onClick={() => onOpenEdit(record)}
                    >
                      ✏️
                    </button>
                    <button
                      type="button"
                      className="btn-icon btn-icon-danger"
                      title="Delete Identity"
                      onClick={() => onDelete(record)}
                    >
                      🗑️
                    </button>
                  </div>
                </div>

                <div className="identity-card-body">
                  {docNumber && (
                    <div className="field-row">
                      <span className="field-name">Doc Number</span>
                      <div className="field-content">
                        <span className="field-text font-mono">
                          {isRevealed ? docNumber : "••••••••••••"}
                        </span>
                        <div style={{ display: "flex", gap: "0.25rem" }}>
                          <button
                            type="button"
                            className="btn-copy-small"
                            onClick={() => toggleReveal(record.id)}
                            title={isRevealed ? "Hide" : "Reveal"}
                          >
                            {isRevealed ? "🙈" : "👁️"}
                          </button>
                          <button
                            type="button"
                            className="btn-copy-small"
                            onClick={() => onCopy(docNumber, "Document Number")}
                            title="Copy Document Number"
                          >
                            📋
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {country && (
                    <div className="field-row">
                      <span className="field-name">Country</span>
                      <span className="field-text">{country}</span>
                    </div>
                  )}

                  {expiry && (
                    <div className="field-row">
                      <span className="field-name">Expires</span>
                      <span className="field-text">{expiry}</span>
                    </div>
                  )}

                  {notes && (
                    <div className="record-notes-snippet">
                      <span className="field-name">Notes:</span> {notes}
                    </div>
                  )}
                </div>

                {record.tags.length > 0 && (
                  <div className="record-tags-row">
                    {record.tags.map((t) => (
                      <span key={t} className="tag-badge">
                        #{t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty-state-card">
          <div className="empty-icon">🪪</div>
          <h3>No identity records found</h3>
          <p>
            Securely store passports, driver's licenses, and government
            identification numbers.
          </p>
          <button type="button" className="btn-primary" onClick={onOpenCreate}>
            + Add First Identity
          </button>
        </div>
      )}
    </div>
  );
};
