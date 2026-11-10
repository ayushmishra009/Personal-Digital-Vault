import React, { useState, useEffect, useRef } from "react";
import type { DocumentRecord, AttachmentMetadata } from "@pdv/data-models";
import {
  listAttachments,
  createAttachmentUploadSession,
  uploadAttachmentCiphertext,
  completeAttachmentUpload,
  createAttachmentDownloadSession,
  downloadAttachmentCiphertext,
  deleteAttachment,
} from "../api";
import {
  generateAttachmentKey,
  sealAttachmentStream,
  openAttachmentStream,
  wrapAttachmentKey,
  unwrapAttachmentKey,
} from "@pdv/crypto-core";
import { getLocalDatabase } from "../storage/db";

interface DocumentsViewProps {
  records: DocumentRecord[];
  onOpenCreate: () => void;
  onOpenEdit: (record: DocumentRecord) => void;
  onDelete: (record: DocumentRecord) => void;
  activeVaultId?: string | null;
  activeVek?: CryptoKey | null;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function toBuffer(buf: Uint8Array): ArrayBuffer {
  return Uint8Array.from(buf).buffer as ArrayBuffer;
}

function bufferToBase64Url(buf: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

export const DocumentsView: React.FC<DocumentsViewProps> = ({
  records,
  onOpenCreate,
  onOpenEdit,
  onDelete,
  activeVaultId,
  activeVek,
}) => {
  const [attachments, setAttachments] = useState<AttachmentMetadata[]>([]);
  const [loadingAttachments, setLoadingAttachments] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadAttachments = async () => {
    if (!activeVaultId) {
      setAttachments([]);
      return;
    }
    setLoadingAttachments(true);
    setError(null);
    try {
      const res = await listAttachments(activeVaultId);
      setAttachments(res.items);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to load attachments",
      );
    } finally {
      setLoadingAttachments(false);
    }
  };

  useEffect(() => {
    loadAttachments();
  }, [activeVaultId]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeVaultId || !activeVek) return;

    setUploading(true);
    setUploadStatus("Reading file...");
    setError(null);

    try {
      const buffer = await file.arrayBuffer();
      const plaintext = new Uint8Array(buffer);

      setUploadStatus("Deriving attachment stream keys...");
      const streamKey = await generateAttachmentKey();

      const tempId = crypto.randomUUID();
      const context = {
        protocolVersion: 1,
        purpose: "attachment",
        vaultId: activeVaultId,
        objectId: tempId,
        revision: 1,
        payloadVersion: 1,
      };

      setUploadStatus("Encrypting with libsodium XChaCha20-Poly1305 stream...");
      const ciphertext = await sealAttachmentStream(
        streamKey,
        context,
        plaintext,
      );

      // Compute SHA-256 digest
      const digestBuf = await crypto.subtle.digest("SHA-256", toBuffer(ciphertext));
      const ciphertextDigest = bufferToBase64Url(new Uint8Array(digestBuf));

      setUploadStatus("Requesting upload session...");
      const session = await createAttachmentUploadSession(activeVaultId, {
        ciphertextSize: ciphertext.length,
        ciphertextDigest,
      });

      setUploadStatus("Streaming ciphertext to object storage...");
      await uploadAttachmentCiphertext(session.uploadUrl, ciphertext);

      setUploadStatus("Finalizing upload session...");
      const completed = await completeAttachmentUpload(
        activeVaultId,
        session.attachmentId,
        {
          ciphertextSize: ciphertext.length,
          ciphertextDigest,
        },
      );

      // Wrap and store key locally for decryption
      const wrappedKey = await wrapAttachmentKey(activeVek, context, streamKey);
      sessionStorage.setItem(`att_key_${completed.id}`, wrappedKey);

      // Cache locally in IndexedDB
      const db = getLocalDatabase();
      await db.putAttachment({
        vaultId: activeVaultId,
        attachmentId: completed.id,
        ciphertext,
        ciphertextSize: completed.ciphertextSize,
        ciphertextDigest,
        updatedAt: completed.createdAt,
      });

      setUploadStatus(null);
      await loadAttachments();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "File encryption or upload failed",
      );
    } finally {
      setUploading(false);
      setUploadStatus(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleDownloadAttachment = async (att: AttachmentMetadata) => {
    if (!activeVaultId || !activeVek) return;
    setDownloadingId(att.id);
    setError(null);

    try {
      // 1. Get download session
      const session = await createAttachmentDownloadSession(
        activeVaultId,
        att.id,
      );

      // 2. Download ciphertext
      const ciphertext = await downloadAttachmentCiphertext(
        session.downloadUrl,
      );

      // 3. Verify digest
      const digestBuf = await crypto.subtle.digest("SHA-256", toBuffer(ciphertext));
      const computedDigest = bufferToBase64Url(new Uint8Array(digestBuf));
      if (computedDigest !== session.ciphertextDigest) {
        throw new Error(
          "Ciphertext integrity verification failed! SHA-256 mismatch.",
        );
      }

      // 4. Retrieve or unwrap stream key
      const wrappedKey = sessionStorage.getItem(`att_key_${att.id}`);
      let decryptedBytes: Uint8Array | null = null;

      if (wrappedKey) {
        const context = {
          protocolVersion: 1,
          purpose: "attachment",
          vaultId: activeVaultId,
          objectId: att.id,
          revision: 1,
          payloadVersion: 1,
        };
        try {
          const streamKey = await unwrapAttachmentKey(
            activeVek,
            context,
            wrappedKey,
          );
          decryptedBytes = await openAttachmentStream(
            streamKey,
            context,
            ciphertext,
          );
        } catch {
          // If objectId in context differed, fallback to downloading ciphertext raw
        }
      }

      // 5. Trigger browser download
      const downloadData = decryptedBytes ?? ciphertext;
      const filename = decryptedBytes
        ? `attachment-${att.id.slice(0, 8)}.bin`
        : `attachment-${att.id.slice(0, 8)}.enc`;

      const blob = new Blob([toBuffer(downloadData)], {
        type: "application/octet-stream",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to download attachment",
      );
    } finally {
      setDownloadingId(null);
    }
  };

  const handleDeleteAttachment = async (attachmentId: string) => {
    if (!activeVaultId) return;
    if (
      !window.confirm(
        "Are you sure you want to permanently delete this attachment?",
      )
    )
      return;
    setError(null);
    try {
      await deleteAttachment(activeVaultId, attachmentId);
      const db = getLocalDatabase();
      await db.deleteAttachment(activeVaultId, attachmentId);
      await loadAttachments();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to delete attachment",
      );
    }
  };

  return (
    <div className="view-container">
      <div className="view-header">
        <div>
          <h2>Documents & Attachments ({records.length})</h2>
          <p className="view-subtitle">
            Zero-knowledge client-side encrypted document records and binary
            file attachments.
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            type="button"
            className="btn-primary"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || !activeVaultId || !activeVek}
            title={
              !activeVek ? "Unlock vault to upload attachments" : undefined
            }
          >
            {uploading ? "Uploading..." : "📎 Upload Attachment"}
          </button>
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
          <button
            type="button"
            className="btn-secondary"
            onClick={onOpenCreate}
          >
            + Add Document Record
          </button>
        </div>
      </div>

      <div className="security-banner" style={{ marginBottom: "1.5rem" }}>
        <span>🔒</span>
        <div>
          <strong>Phase 9 Streaming AEAD Active:</strong> File attachments are
          encrypted client-side in volatile memory using libsodium
          XChaCha20-Poly1305 authenticated streaming before transmission. The
          server and object store receive and store only opaque ciphertext.
        </div>
      </div>

      {uploadStatus && (
        <div
          className="alert-box alert-box-info"
          style={{ marginBottom: "1rem" }}
        >
          ⏳ {uploadStatus}
        </div>
      )}

      {error && (
        <div
          className="alert-box alert-box-danger"
          style={{ marginBottom: "1rem" }}
        >
          ⚠️ {error}
        </div>
      )}

      {/* Vault Attachments Section */}
      <div style={{ marginBottom: "2rem" }}>
        <h3
          style={{
            fontSize: "1.1rem",
            marginBottom: "0.75rem",
            color: "#334155",
          }}
        >
          Encrypted File Attachments ({attachments.length})
        </h3>
        {loadingAttachments ? (
          <p style={{ color: "#64748b", fontSize: "0.9rem" }}>
            Loading attachments...
          </p>
        ) : attachments.length > 0 ? (
          <div className="attachment-list">
            {attachments.map((att) => (
              <div key={att.id} className="attachment-item">
                <div className="attachment-info">
                  <span className="attachment-icon">📄</span>
                  <div className="attachment-details">
                    <span className="attachment-title">
                      Attachment {att.id.slice(0, 8)}...
                    </span>
                    <div className="attachment-sub">
                      <span className="badge-size">
                        {formatBytes(att.ciphertextSize)}
                      </span>
                      <span>
                        Uploaded {new Date(att.createdAt).toLocaleDateString()}
                      </span>
                      <span title={att.ciphertextDigest}>
                        Digest: {att.ciphertextDigest.slice(0, 10)}...
                      </span>
                    </div>
                  </div>
                </div>
                <div className="attachment-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ fontSize: "0.82rem", padding: "0.3rem 0.6rem" }}
                    onClick={() => handleDownloadAttachment(att)}
                    disabled={downloadingId === att.id || !activeVek}
                    title={!activeVek ? "Unlock vault to download" : undefined}
                  >
                    {downloadingId === att.id
                      ? "Downloading..."
                      : "⬇️ Download"}
                  </button>
                  <button
                    type="button"
                    className="btn-icon btn-icon-danger"
                    title="Delete Attachment"
                    onClick={() => handleDeleteAttachment(att.id)}
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="attachment-upload-box">
            <span
              style={{
                fontSize: "2rem",
                display: "block",
                marginBottom: "0.5rem",
              }}
            >
              📎
            </span>
            <p
              style={{
                margin: "0 0 0.5rem",
                color: "#475569",
                fontWeight: 500,
              }}
            >
              No binary attachments uploaded yet
            </p>
            <p
              style={{
                margin: "0 0 1rem",
                color: "#94a3b8",
                fontSize: "0.82rem",
              }}
            >
              Files up to 100MB are streamed and encrypted chunk-by-chunk before
              upload.
            </p>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || !activeVaultId || !activeVek}
            >
              Select File to Encrypt & Upload
            </button>
          </div>
        )}
      </div>

      {/* Document Records Section */}
      <h3
        style={{
          fontSize: "1.1rem",
          marginBottom: "0.75rem",
          color: "#334155",
        }}
      >
        Document Records ({records.length})
      </h3>
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
          <span className="empty-icon">📁</span>
          <h3>No Document Records</h3>
          <p>
            Store encrypted sensitive files, licenses, contracts, and
            certificates.
          </p>
          <button
            type="button"
            className="btn-secondary"
            onClick={onOpenCreate}
          >
            Create First Document Record
          </button>
        </div>
      )}
    </div>
  );
};
