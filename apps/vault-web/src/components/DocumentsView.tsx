import React from "react";
import type { DocumentRecord } from "@pdv/data-models";

interface DocumentsViewProps {
  records: DocumentRecord[];
  onOpenCreate: () => void;
  onOpenEdit: (record: DocumentRecord) => void;
  onDelete: (record: DocumentRecord) => void;
}

export const DocumentsView: React.FC<DocumentsViewProps> = ({
  records,
  onOpenCreate,
  onOpenEdit,
  onDelete,
}) => {
  return (
    <div className="view-container">
      <div className="view-header">
        <div>
          <h2>Documents & Files ({records.length})</h2>
          <p className="view-subtitle">
            Encrypted document metadata and file attachments. Client-side
            streaming encryption arriving in Phase 9.
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={onOpenCreate}>
          + Add Document
        </button>
      </div>

      <div className="security-banner" style={{ marginBottom: "1.5rem" }}>
        <span>📎</span>
        <div>
          <strong>Attachment Architecture Notice (Phase 9):</strong> Document
          records store encrypted metadata in IndexedDB. Large file binary
          streams will be encrypted chunk-by-chunk using client-side AES-256-GCM
          AEAD and streamed to S3/MinIO in Phase 9.
        </div>
      </div>

      {records.length > 0 ? (
        <div className="records-grid">
          {records.map((doc) => (
            <div key={doc.id} className="card record-card">
              <div className="record-card-top">
                <div className="record-card-title-group">
                  <span className="record-type-icon">📁</span>
                  <h3 className="record-card-title">{doc.title}</h3>
                </div>
                <div className="record-card-actions">
                  <button
                    type="button"
                    className="btn-icon"
                    title="Edit Document"
                    onClick={() => onOpenEdit(doc)}
                  >
                    ✏️
                  </button>
                  <button
                    type="button"
                    className="btn-icon btn-icon-danger"
                    title="Delete Document"
                    onClick={() => onDelete(doc)}
                  >
                    🗑️
                  </button>
                </div>
              </div>

              <div className="record-card-body">
                <div className="field-row">
                  <span className="field-name">Attachments</span>
                  <span className="field-text">
                    {doc.attachmentIds.length} file
                    {doc.attachmentIds.length === 1 ? "" : "s"} attached
                  </span>
                </div>
                <div className="field-row">
                  <span className="field-name">Updated</span>
                  <span className="field-text">
                    {new Date(doc.updatedAt).toLocaleDateString()}
                  </span>
                </div>
              </div>

              {doc.tags.length > 0 && (
                <div className="record-tags-row">
                  {doc.tags.map((t) => (
                    <span key={t} className="tag-badge">
                      #{t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-state-card">
          <div className="empty-icon">📁</div>
          <h3>No documents cataloged</h3>
          <p>
            Create confidential document records and organize private files.
          </p>
          <button type="button" className="btn-primary" onClick={onOpenCreate}>
            + Add First Document
          </button>
        </div>
      )}
    </div>
  );
};
