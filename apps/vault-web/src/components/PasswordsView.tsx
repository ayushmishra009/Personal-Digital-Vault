import React, { useState } from "react";
import type { PasswordRecord } from "@pdv/data-models";

interface PasswordsViewProps {
  records: PasswordRecord[];
  onOpenCreate: () => void;
  onOpenEdit: (record: PasswordRecord) => void;
  onDelete: (record: PasswordRecord) => void;
  onCopy: (text: string, label: string) => void;
  onOpenGenerator: () => void;
}

export const PasswordsView: React.FC<PasswordsViewProps> = ({
  records,
  onOpenCreate,
  onOpenEdit,
  onDelete,
  onCopy,
  onOpenGenerator,
}) => {
  const [revealedIds, setRevealedIds] = useState<Record<string, boolean>>({});
  const [selectedTag, setSelectedTag] = useState<string>("all");

  const toggleReveal = (id: string) => {
    setRevealedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Collect all unique tags
  const allTags = Array.from(new Set(records.flatMap((r) => r.tags)));

  const filtered = records.filter(
    (r) => selectedTag === "all" || r.tags.includes(selectedTag),
  );

  return (
    <div className="view-container">
      <div className="view-header">
        <div>
          <h2>Passwords ({records.length})</h2>
          <p className="view-subtitle">
            Zero-knowledge encrypted logins. Passwords and credentials never
            leave your browser unencrypted.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={onOpenGenerator}
          >
            ⚡ Generator
          </button>
          <button type="button" className="btn-primary" onClick={onOpenCreate}>
            + Add Password
          </button>
        </div>
      </div>

      {/* Tag filter bar */}
      {allTags.length > 0 && (
        <div className="tag-filter-bar">
          <span
            style={{
              fontSize: "0.82rem",
              color: "#556b5a",
              alignSelf: "center",
            }}
          >
            Tags:
          </span>
          <button
            type="button"
            className={`tag-filter-btn ${selectedTag === "all" ? "active" : ""}`}
            onClick={() => setSelectedTag("all")}
          >
            All
          </button>
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              className={`tag-filter-btn ${selectedTag === tag ? "active" : ""}`}
              onClick={() => setSelectedTag(tag)}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}

      {filtered.length > 0 ? (
        <div className="records-grid">
          {filtered.map((record) => {
            const isRevealed = !!revealedIds[record.id];
            return (
              <div key={record.id} className="card record-card">
                <div className="record-card-top">
                  <div className="record-card-title-group">
                    <span className="record-type-icon">🔑</span>
                    <h3 className="record-card-title">{record.title}</h3>
                  </div>
                  <div className="record-card-actions">
                    <button
                      type="button"
                      className="btn-icon"
                      title="Edit Password"
                      onClick={() => onOpenEdit(record)}
                    >
                      ✏️
                    </button>
                    <button
                      type="button"
                      className="btn-icon btn-icon-danger"
                      title="Delete Password"
                      onClick={() => onDelete(record)}
                    >
                      🗑️
                    </button>
                  </div>
                </div>

                <div className="record-card-body">
                  {record.username && (
                    <div className="field-row">
                      <span className="field-name">Username</span>
                      <div className="field-content">
                        <span className="field-text">{record.username}</span>
                        <button
                          type="button"
                          className="btn-copy-small"
                          onClick={() => onCopy(record.username!, "Username")}
                          title="Copy Username"
                        >
                          📋
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="field-row">
                    <span className="field-name">Password</span>
                    <div className="field-content">
                      <span className="field-text font-mono">
                        {isRevealed ? record.password : "••••••••••••••••"}
                      </span>
                      <div style={{ display: "flex", gap: "0.25rem" }}>
                        <button
                          type="button"
                          className="btn-copy-small"
                          onClick={() => toggleReveal(record.id)}
                          title={
                            isRevealed ? "Hide Password" : "Reveal Password"
                          }
                        >
                          {isRevealed ? "🙈" : "👁️"}
                        </button>
                        <button
                          type="button"
                          className="btn-copy-small"
                          onClick={() => onCopy(record.password, "Password")}
                          title="Copy to Clipboard (Auto-clears in 30s)"
                        >
                          📋
                        </button>
                      </div>
                    </div>
                  </div>

                  {record.url && (
                    <div className="field-row">
                      <span className="field-name">Website</span>
                      <div className="field-content">
                        <a
                          href={
                            record.url.startsWith("http")
                              ? record.url
                              : `https://${record.url}`
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="external-link"
                        >
                          {record.url} ↗
                        </a>
                      </div>
                    </div>
                  )}

                  {record.notes && (
                    <div className="record-notes-snippet">
                      <span className="field-name">Notes:</span> {record.notes}
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
          <div className="empty-icon">🔑</div>
          <h3>No password logins found</h3>
          <p>
            Store your first login credential with zero-knowledge AES-256-GCM
            encryption.
          </p>
          <button type="button" className="btn-primary" onClick={onOpenCreate}>
            + Add New Password
          </button>
        </div>
      )}
    </div>
  );
};
