import React, { useState } from "react";
import type { PaymentRecord } from "@pdv/data-models";

interface PaymentsViewProps {
  records: PaymentRecord[];
  onOpenCreate: () => void;
  onOpenEdit: (record: PaymentRecord) => void;
  onDelete: (record: PaymentRecord) => void;
  onCopy: (text: string, label: string) => void;
}

function detectCardBrand(num: string): string {
  const clean = num.replace(/\D/g, "");
  if (clean.startsWith("4")) return "VISA";
  if (/^5[1-5]/.test(clean)) return "MASTERCARD";
  if (/^3[47]/.test(clean)) return "AMEX";
  if (/^6(?:011|5)/.test(clean)) return "DISCOVER";
  return "CARD";
}

function maskCardNumber(num: string, revealed: boolean): string {
  const clean = num.replace(/\s+/g, "");
  if (revealed) {
    return clean.replace(/(\d{4})/g, "$1 ").trim();
  }
  if (clean.length >= 4) {
    const last4 = clean.slice(-4);
    return `•••• •••• •••• ${last4}`;
  }
  return "•••• •••• •••• ••••";
}

export const PaymentsView: React.FC<PaymentsViewProps> = ({
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
          <h2>Payment Cards ({records.length})</h2>
          <p className="view-subtitle">
            Encrypted payment cards, CVVs, and bank account details. Numbers are
            never sent across the network.
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={onOpenCreate}>
          + Add Payment Card
        </button>
      </div>

      {records.length > 0 ? (
        <div className="payment-cards-grid">
          {records.map((record) => {
            const isRevealed = !!revealedIds[record.id];
            const holder = String(record.fields["cardholderName"] || "");
            const rawNumber = String(record.fields["cardNumber"] || "");
            const expMonth = String(record.fields["expiryMonth"] || "");
            const expYear = String(record.fields["expiryYear"] || "");
            const cvv = String(record.fields["cvv"] || "");
            const billingAddress = String(
              record.fields["billingAddress"] || "",
            );
            const brand = detectCardBrand(rawNumber);

            return (
              <div key={record.id} className="payment-card-container">
                {/* Virtual Card Front */}
                <div className={`virtual-card ${brand.toLowerCase()}`}>
                  <div className="virtual-card-top">
                    <span className="card-chip"></span>
                    <span className="card-brand-badge">{brand}</span>
                  </div>

                  <div className="virtual-card-number">
                    {maskCardNumber(rawNumber, isRevealed)}
                  </div>

                  <div className="virtual-card-bottom">
                    <div className="card-holder-group">
                      <span className="card-micro-label">CARDHOLDER</span>
                      <span className="card-holder-name">
                        {holder || "CARDHOLDER NAME"}
                      </span>
                    </div>

                    <div className="card-expiry-group">
                      <span className="card-micro-label">EXPIRES</span>
                      <span className="card-expiry-date">
                        {expMonth && expYear
                          ? `${expMonth.padStart(2, "0")}/${expYear.slice(-2)}`
                          : "MM/YY"}
                      </span>
                    </div>

                    {cvv && (
                      <div className="card-cvv-group">
                        <span className="card-micro-label">CVV</span>
                        <span className="card-cvv-val font-mono">
                          {isRevealed ? cvv : "•••"}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Card Controls Panel */}
                <div className="payment-controls-panel">
                  <div className="payment-title-row">
                    <strong>{record.title}</strong>
                    <div className="record-card-actions">
                      <button
                        type="button"
                        className="btn-icon"
                        title="Reveal Details"
                        onClick={() => toggleReveal(record.id)}
                      >
                        {isRevealed ? "🙈" : "👁️"}
                      </button>
                      <button
                        type="button"
                        className="btn-icon"
                        title="Copy Card Number"
                        onClick={() =>
                          onCopy(rawNumber.replace(/\s+/g, ""), "Card Number")
                        }
                      >
                        📋
                      </button>
                      <button
                        type="button"
                        className="btn-icon"
                        title="Edit Card"
                        onClick={() => onOpenEdit(record)}
                      >
                        ✏️
                      </button>
                      <button
                        type="button"
                        className="btn-icon btn-icon-danger"
                        title="Delete Card"
                        onClick={() => onDelete(record)}
                      >
                        🗑️
                      </button>
                    </div>
                  </div>

                  {billingAddress && (
                    <div className="payment-billing-line">
                      <span className="field-name">Billing:</span>{" "}
                      {billingAddress}
                    </div>
                  )}

                  {record.tags.length > 0 && (
                    <div
                      className="record-tags-row"
                      style={{ marginTop: "0.5rem" }}
                    >
                      {record.tags.map((t) => (
                        <span key={t} className="tag-badge">
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty-state-card">
          <div className="empty-icon">💳</div>
          <h3>No payment cards stored</h3>
          <p>
            Safely store credit cards, debit cards, and CVVs with zero-knowledge
            client encryption.
          </p>
          <button type="button" className="btn-primary" onClick={onOpenCreate}>
            + Add First Payment Card
          </button>
        </div>
      )}
    </div>
  );
};
