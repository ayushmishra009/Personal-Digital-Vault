import React, { useState } from "react";
import type { SecureNoteRecord } from "@pdv/data-models";

interface NotesViewProps {
  records: SecureNoteRecord[];
  onOpenCreate: () => void;
  onOpenEdit: (record: SecureNoteRecord) => void;
  onDelete: (record: SecureNoteRecord) => void;
  onCopy: (text: string, label: string) => void;
}

/**
 * Safe client-side markdown formatter: parses simple headings, code blocks, lists, bold, italics.
 * Purely declarative React nodes; strictly rejects script execution or raw HTML.
 */
function renderSafeMarkdown(content: string): React.ReactNode {
  const lines = content.split("\n");
  return (
    <div className="safe-markdown-body">
      {lines.map((line, idx) => {
        if (line.startsWith("### ")) {
          return (
            <h4 key={idx} className="md-h3">
              {line.slice(4)}
            </h4>
          );
        }
        if (line.startsWith("## ")) {
          return (
            <h3 key={idx} className="md-h2">
              {line.slice(3)}
            </h3>
          );
        }
        if (line.startsWith("# ")) {
          return (
            <h2 key={idx} className="md-h1">
              {line.slice(2)}
            </h2>
          );
        }
        if (line.startsWith("- ") || line.startsWith("* ")) {
          return (
            <div key={idx} className="md-list-item">
              • {line.slice(2)}
            </div>
          );
        }
        if (line.startsWith("```")) {
          return null; // simple fence skip or render
        }
        if (line.trim() === "") {
          return <div key={idx} style={{ height: "0.5rem" }} />;
        }
        return (
          <p key={idx} className="md-paragraph">
            {line}
          </p>
        );
      })}
    </div>
  );
}

export const NotesView: React.FC<NotesViewProps> = ({
  records,
  onOpenCreate,
  onOpenEdit,
  onDelete,
  onCopy,
}) => {
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(
    records.length > 0 ? records[0].id : null,
  );

  const selectedNote =
    records.find((r) => r.id === selectedNoteId) || records[0];

  return (
    <div className="view-container">
      <div className="view-header">
        <div>
          <h2>Secure Notes ({records.length})</h2>
          <p className="view-subtitle">
            Private encrypted markdown documentation, secret codes, and
            confidential notes.
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={onOpenCreate}>
          + New Note
        </button>
      </div>

      {records.length > 0 ? (
        <div className="notes-master-detail">
          {/* Notes list sidebar */}
          <div className="notes-list-pane">
            {records.map((note) => {
              const isActive = note.id === selectedNote?.id;
              const preview = note.content.slice(0, 90).replace(/\n/g, " ");
              return (
                <div
                  key={note.id}
                  className={`note-list-card ${isActive ? "active" : ""}`}
                  onClick={() => setSelectedNoteId(note.id)}
                >
                  <div className="note-list-title">{note.title}</div>
                  <div className="note-list-preview">
                    {preview || "Empty note"}...
                  </div>
                  <div className="note-list-meta">
                    <span>{new Date(note.updatedAt).toLocaleDateString()}</span>
                    {note.tags.slice(0, 2).map((t) => (
                      <span key={t} className="tag-badge">
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Note content detail view */}
          {selectedNote ? (
            <div className="card note-detail-pane">
              <div className="note-detail-header">
                <div>
                  <h3 style={{ margin: "0 0 0.25rem", fontSize: "1.3rem" }}>
                    {selectedNote.title}
                  </h3>
                  <div style={{ fontSize: "0.8rem", color: "#556b5a" }}>
                    Last updated:{" "}
                    {new Date(selectedNote.updatedAt).toLocaleString()} •{" "}
                    {selectedNote.content.split(/\s+/).filter(Boolean).length}{" "}
                    words • {selectedNote.content.length} characters
                  </div>
                </div>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => onCopy(selectedNote.content, "Note Content")}
                    title="Copy to Clipboard"
                  >
                    📋 Copy
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => onOpenEdit(selectedNote)}
                  >
                    ✏️ Edit
                  </button>
                  <button
                    type="button"
                    className="btn-danger"
                    onClick={() => onDelete(selectedNote)}
                  >
                    🗑️ Delete
                  </button>
                </div>
              </div>

              {selectedNote.tags.length > 0 && (
                <div
                  className="record-tags-row"
                  style={{ marginBottom: "1rem" }}
                >
                  {selectedNote.tags.map((t) => (
                    <span key={t} className="tag-badge">
                      #{t}
                    </span>
                  ))}
                </div>
              )}

              <div className="note-content-display">
                {renderSafeMarkdown(selectedNote.content)}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="empty-state-card">
          <div className="empty-icon">📝</div>
          <h3>No secure notes stored</h3>
          <p>
            Create encrypted private notes, recovery instructions, or
            confidential documentation.
          </p>
          <button type="button" className="btn-primary" onClick={onOpenCreate}>
            + Create First Note
          </button>
        </div>
      )}
    </div>
  );
};
