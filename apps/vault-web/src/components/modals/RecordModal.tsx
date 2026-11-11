import React, { useState } from "react";
import type {
  DecryptedRecord,
  PasswordRecord,
  SecureNoteRecord,
  IdentityRecord,
  PaymentRecord,
  DocumentRecord,
} from "@pdv/data-models";
import {
  generatePassword,
  estimatePasswordStrength,
} from "../../storage/password-generator";

interface RecordModalProps {
  editingRecord: DecryptedRecord | null;
  defaultType?:
    "password" | "secure-note" | "identity" | "payment" | "document";
  onSave: (record: DecryptedRecord) => Promise<void>;
  onClose: () => void;
}

export const RecordModal: React.FC<RecordModalProps> = ({
  editingRecord,
  defaultType = "password",
  onSave,
  onClose,
}) => {
  const [recordType, setRecordType] = useState<
    "password" | "secure-note" | "identity" | "payment" | "document"
  >(editingRecord ? editingRecord.type : defaultType);

  const [title, setTitle] = useState(editingRecord ? editingRecord.title : "");
  const [tagsStr, setTagsStr] = useState(
    editingRecord ? editingRecord.tags.join(", ") : "",
  );

  // Password fields
  const initialPw =
    editingRecord && editingRecord.type === "password" ? editingRecord : null;
  const [pwUsername, setPwUsername] = useState(initialPw?.username || "");
  const [pwPassword, setPwPassword] = useState(initialPw?.password || "");
  const [pwUrl, setPwUrl] = useState(initialPw?.url || "");
  const [pwNotes, setPwNotes] = useState(initialPw?.notes || "");

  // Note fields
  const initialNote =
    editingRecord && editingRecord.type === "secure-note"
      ? editingRecord
      : null;
  const [noteContent, setNoteContent] = useState(initialNote?.content || "");

  // Identity fields
  const initialId =
    editingRecord && editingRecord.type === "identity" ? editingRecord : null;
  const [idType, setIdType] = useState(
    String(initialId?.fields?.idType || "Passport"),
  );
  const [idFullName, setIdFullName] = useState(
    String(initialId?.fields?.fullName || ""),
  );
  const [idNumber, setIdNumber] = useState(
    String(initialId?.fields?.documentNumber || ""),
  );
  const [idCountry, setIdCountry] = useState(
    String(initialId?.fields?.issuingCountry || ""),
  );
  const [idExpiry, setIdExpiry] = useState(
    String(initialId?.fields?.expiryDate || ""),
  );
  const [idNotes, setIdNotes] = useState(
    String(initialId?.fields?.notes || ""),
  );

  // Payment fields
  const initialPay =
    editingRecord && editingRecord.type === "payment" ? editingRecord : null;
  const [cardHolder, setCardHolder] = useState(
    String(initialPay?.fields?.cardholderName || ""),
  );
  const [cardNumber, setCardNumber] = useState(
    String(initialPay?.fields?.cardNumber || ""),
  );
  const [expMonth, setExpMonth] = useState(
    String(initialPay?.fields?.expiryMonth || ""),
  );
  const [expYear, setExpYear] = useState(
    String(initialPay?.fields?.expiryYear || ""),
  );
  const [cardCvv, setCardCvv] = useState(String(initialPay?.fields?.cvv || ""));
  const [billingAddress, setBillingAddress] = useState(
    String(initialPay?.fields?.billingAddress || ""),
  );

  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleMiniGenerate = () => {
    const generated = generatePassword({
      length: 20,
      uppercase: true,
      lowercase: true,
      numbers: true,
      symbols: true,
      excludeAmbiguous: true,
    });
    setPwPassword(generated);
  };

  const pwStrength = estimatePasswordStrength(pwPassword);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Title is required");
      return;
    }

    const tags = tagsStr
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    const now = new Date().toISOString();
    const id = editingRecord ? editingRecord.id : crypto.randomUUID();
    const createdAt = editingRecord ? editingRecord.createdAt : now;
    const updatedAt = now;

    let payload: DecryptedRecord;

    if (recordType === "password") {
      if (!pwPassword) {
        setError("Password cannot be empty");
        return;
      }
      payload = {
        id,
        title: title.trim(),
        type: "password",
        username: pwUsername.trim() || undefined,
        password: pwPassword,
        url: pwUrl.trim() || undefined,
        notes: pwNotes.trim() || undefined,
        tags,
        createdAt,
        updatedAt,
      } as PasswordRecord;
    } else if (recordType === "secure-note") {
      payload = {
        id,
        title: title.trim(),
        type: "secure-note",
        content: noteContent,
        tags,
        createdAt,
        updatedAt,
      } as SecureNoteRecord;
    } else if (recordType === "identity") {
      payload = {
        id,
        title: title.trim(),
        type: "identity",
        fields: {
          idType,
          fullName: idFullName.trim(),
          documentNumber: idNumber.trim(),
          issuingCountry: idCountry.trim(),
          expiryDate: idExpiry.trim(),
          notes: idNotes.trim(),
        },
        tags,
        createdAt,
        updatedAt,
      } as IdentityRecord;
    } else if (recordType === "payment") {
      payload = {
        id,
        title: title.trim(),
        type: "payment",
        fields: {
          cardholderName: cardHolder.trim(),
          cardNumber: cardNumber.replace(/\s+/g, ""),
          expiryMonth: expMonth.trim(),
          expiryYear: expYear.trim(),
          cvv: cardCvv.trim(),
          billingAddress: billingAddress.trim(),
        },
        tags,
        createdAt,
        updatedAt,
      } as PaymentRecord;
    } else {
      payload = {
        id,
        title: title.trim(),
        type: "document",
        attachmentIds: [],
        tags,
        createdAt,
        updatedAt,
      } as DocumentRecord;
    }

    try {
      setIsSaving(true);
      setError(null);
      await onSave(payload);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save record");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 620 }}>
        <div className="modal-header">
          <h3>
            {editingRecord ? `Edit ${editingRecord.type}` : "Add Vault Record"}
          </h3>
          <button type="button" className="btn-secondary" onClick={onClose}>
            ✕
          </button>
        </div>

        {error && <div className="alert alert-danger">{error}</div>}

        <form onSubmit={handleSubmit}>
          {!editingRecord && (
            <div className="form-group" style={{ marginBottom: "1rem" }}>
              <label>Record Type</label>
              <select
                className="form-control"
                value={recordType}
                onChange={(e) =>
                  setRecordType(
                    e.target.value as
                      | "password"
                      | "secure-note"
                      | "identity"
                      | "payment"
                      | "document",
                  )
                }
              >
                <option value="password">🔑 Password Login</option>
                <option value="secure-note">📝 Secure Note</option>
                <option value="identity">🪪 Identity Document</option>
                <option value="payment">💳 Payment Card</option>
                <option value="document">📁 Document / File Reference</option>
              </select>
            </div>
          )}

          <div className="form-group">
            <label>Title *</label>
            <input
              type="text"
              className="form-control"
              placeholder="e.g. GitHub, Personal Notes, US Passport"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>

          <div className="form-group">
            <label>Tags (comma separated)</label>
            <input
              type="text"
              className="form-control"
              placeholder="e.g. work, personal, critical"
              value={tagsStr}
              onChange={(e) => setTagsStr(e.target.value)}
            />
          </div>

          {/* PASSWORD FIELDS */}
          {recordType === "password" && (
            <>
              <div className="form-group">
                <label>Username / Email</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="e.g. user@example.com"
                  value={pwUsername}
                  onChange={(e) => setPwUsername(e.target.value)}
                />
              </div>

              <div className="form-group">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <label>Password *</label>
                  <button
                    type="button"
                    className="btn-link"
                    style={{
                      fontSize: "0.8rem",
                      color: "var(--primary-color)",
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                    }}
                    onClick={handleMiniGenerate}
                  >
                    ⚡ Generate Strong
                  </button>
                </div>
                <input
                  type="text"
                  className="form-control font-mono"
                  value={pwPassword}
                  onChange={(e) => setPwPassword(e.target.value)}
                  required
                />
                {pwPassword && (
                  <div style={{ marginTop: "0.4rem" }}>
                    <div className="strength-bar">
                      <div
                        className="strength-fill"
                        style={{
                          width: `${Math.min(100, (pwStrength.entropyBits / 90) * 100)}%`,
                          backgroundColor: pwStrength.color,
                        }}
                      />
                    </div>
                    <div
                      style={{
                        fontSize: "0.75rem",
                        color: "var(--xai-mute, #7d8187)",
                        marginTop: "0.2rem",
                      }}
                    >
                      Strength:{" "}
                      <strong style={{ color: pwStrength.color }}>
                        {pwStrength.label}
                      </strong>{" "}
                      (~{pwStrength.entropyBits} bits entropy)
                    </div>
                  </div>
                )}
              </div>

              <div className="form-group">
                <label>Website URL</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="e.g. https://github.com"
                  value={pwUrl}
                  onChange={(e) => setPwUrl(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>Private Notes</label>
                <textarea
                  className="form-control"
                  rows={2}
                  placeholder="Additional credentials, security questions, or notes"
                  value={pwNotes}
                  onChange={(e) => setPwNotes(e.target.value)}
                />
              </div>
            </>
          )}

          {/* SECURE NOTE FIELDS */}
          {recordType === "secure-note" && (
            <div className="form-group">
              <label>Note Content (Markdown supported)</label>
              <textarea
                className="form-control"
                rows={8}
                placeholder="Write your encrypted notes here..."
                value={noteContent}
                onChange={(e) => setNoteContent(e.target.value)}
              />
            </div>
          )}

          {/* IDENTITY FIELDS */}
          {recordType === "identity" && (
            <>
              <div className="form-row">
                <div className="form-group">
                  <label>Document Type</label>
                  <select
                    className="form-control"
                    value={idType}
                    onChange={(e) => setIdType(e.target.value)}
                  >
                    <option value="Passport">Passport</option>
                    <option value="Driver's License">Driver's License</option>
                    <option value="National ID">National ID Card</option>
                    <option value="Social Security">
                      Social Security Number
                    </option>
                    <option value="Personal Profile">Personal Profile</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Full Legal Name</label>
                  <input
                    type="text"
                    className="form-control"
                    value={idFullName}
                    onChange={(e) => setIdFullName(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Document Number</label>
                  <input
                    type="text"
                    className="form-control font-mono"
                    value={idNumber}
                    onChange={(e) => setIdNumber(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Issuing Country / Authority</label>
                  <input
                    type="text"
                    className="form-control"
                    value={idCountry}
                    onChange={(e) => setIdCountry(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Expiration Date</label>
                <input
                  type="date"
                  className="form-control"
                  value={idExpiry}
                  onChange={(e) => setIdExpiry(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>Notes / Extra Information</label>
                <textarea
                  className="form-control"
                  rows={3}
                  placeholder="Additional notes about this identity document"
                  value={idNotes}
                  onChange={(e) => setIdNotes(e.target.value)}
                />
              </div>
            </>
          )}

          {/* PAYMENT FIELDS */}
          {recordType === "payment" && (
            <>
              <div className="form-group">
                <label>Cardholder Name</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="John Doe"
                  value={cardHolder}
                  onChange={(e) => setCardHolder(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label>Card Number</label>
                <input
                  type="text"
                  className="form-control font-mono"
                  placeholder="16-digit card number"
                  value={cardNumber}
                  onChange={(e) => setCardNumber(e.target.value)}
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Expiry (MM / YYYY)</label>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    <input
                      type="text"
                      className="form-control"
                      placeholder="MM"
                      maxLength={2}
                      value={expMonth}
                      onChange={(e) => setExpMonth(e.target.value)}
                    />
                    <input
                      type="text"
                      className="form-control"
                      placeholder="YYYY"
                      maxLength={4}
                      value={expYear}
                      onChange={(e) => setExpYear(e.target.value)}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label>Security Code (CVV)</label>
                  <input
                    type="password"
                    className="form-control font-mono"
                    maxLength={4}
                    placeholder="123"
                    value={cardCvv}
                    onChange={(e) => setCardCvv(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Billing Address / Bank Notes</label>
                <input
                  type="text"
                  className="form-control"
                  value={billingAddress}
                  onChange={(e) => setBillingAddress(e.target.value)}
                />
              </div>
            </>
          )}

          <div className="modal-footer">
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={isSaving}
            >
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={isSaving}>
              {isSaving
                ? "Encrypting & Storing..."
                : editingRecord
                  ? "Save Changes"
                  : "Create Record"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
