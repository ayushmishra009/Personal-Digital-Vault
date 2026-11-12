import React from "react";
import type { CmsSection } from "@pdv/data-models";

export interface CmsRendererActions {
  onOpenCreateModal?: () => void;
  onOpenGenerator?: () => void;
  onLockVault?: () => void;
  recordCount?: number;
  vaultUnlocked?: boolean;
}

interface CmsSectionRendererProps {
  section: CmsSection;
  actions?: CmsRendererActions;
}

/**
 * Finite Trusted Component Registry for CMS sections.
 *
 * Enforces strict zero-knowledge security:
 * - Declarative only; NO dangerouslySetInnerHTML, NO script evaluation, NO arbitrary HTML/CSS.
 * - All content payloads are cast to safe primitive text.
 * - Actions are dispatched only to pre-registered client callbacks.
 */
export const CmsSectionRenderer: React.FC<CmsSectionRendererProps> = ({
  section,
  actions,
}) => {
  if (!section.isEnabled) {
    return null;
  }

  const payload = section.contentPayload || {};

  switch (section.sectionType) {
    case "welcome": {
      const greeting =
        typeof payload.greeting === "string" ? payload.greeting : section.title;
      const subtitle =
        typeof payload.subtitle === "string"
          ? payload.subtitle
          : "Zero-knowledge encrypted storage";
      return (
        <div
          className="card cms-welcome-section"
          style={{ borderLeft: "2px solid var(--xai-ink, #ffffff)" }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
            }}
          >
            <div>
              <h2 style={{ margin: "0 0 0.25rem", fontSize: "1.3rem" }}>
                {greeting}
              </h2>
              <p
                style={{
                  margin: 0,
                  color: "var(--xai-mute, #7d8187)",
                  fontSize: "0.9rem",
                }}
              >
                {subtitle}
              </p>
            </div>
            <span
              style={{
                background: "var(--xai-canvas-soft, #1a1c20)",
                border: "1px solid var(--xai-hairline, #212327)",
                color: "var(--xai-accent-breeze, #a0c3ec)",
                padding: "0.25rem 0.6rem",
                borderRadius: "9999px",
                fontSize: "0.75rem",
                fontWeight: 400,
                fontFamily: "var(--font-mono)",
              }}
            >
              🔒 End-to-End Encrypted
            </span>
          </div>
        </div>
      );
    }

    case "summary": {
      const statusTitle = section.title || "Vault Security Status";
      return (
        <div className="card cms-summary-section">
          <h3 style={{ margin: "0 0 1rem", fontSize: "1.1rem" }}>
            {statusTitle}
          </h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: "1rem",
            }}
          >
            <div
              style={{
                background: "var(--xai-canvas-soft, #1a1c20)",
                padding: "1rem",
                borderRadius: "8px",
                border: "1px solid var(--xai-hairline, #212327)",
              }}
            >
              <div
                style={{
                  fontSize: "0.78rem",
                  color: "var(--xai-mute, #7d8187)",
                  textTransform: "uppercase",
                  fontFamily: "var(--font-mono)",
                  letterSpacing: "1.2px",
                }}
              >
                Active Records
              </div>
              <div
                style={{
                  fontSize: "1.5rem",
                  fontWeight: 400,
                  marginTop: "0.25rem",
                  color: "var(--xai-ink, #ffffff)",
                }}
              >
                {actions?.recordCount ?? 0}
              </div>
            </div>
            <div
              style={{
                background: "var(--xai-canvas-soft, #1a1c20)",
                padding: "1rem",
                borderRadius: "8px",
                border: "1px solid var(--xai-hairline, #212327)",
              }}
            >
              <div
                style={{
                  fontSize: "0.78rem",
                  color: "var(--xai-mute, #7d8187)",
                  textTransform: "uppercase",
                  fontFamily: "var(--font-mono)",
                  letterSpacing: "1.2px",
                }}
              >
                Encryption Engine
              </div>
              <div
                style={{
                  fontSize: "0.95rem",
                  fontWeight: 400,
                  marginTop: "0.4rem",
                  color: "var(--xai-ink, #ffffff)",
                }}
              >
                Argon2id (p=4) + AES-256-GCM
              </div>
            </div>
            <div
              style={{
                background: "var(--xai-canvas-soft, #1a1c20)",
                padding: "1rem",
                borderRadius: "8px",
                border: "1px solid var(--xai-hairline, #212327)",
              }}
            >
              <div
                style={{
                  fontSize: "0.78rem",
                  color: "var(--xai-mute, #7d8187)",
                  textTransform: "uppercase",
                  fontFamily: "var(--font-mono)",
                  letterSpacing: "1.2px",
                }}
              >
                Local Store
              </div>
              <div
                style={{
                  fontSize: "0.95rem",
                  fontWeight: 400,
                  marginTop: "0.4rem",
                  color: "var(--xai-accent-breeze, #a0c3ec)",
                }}
              >
                IndexedDB (pdv_local_store)
              </div>
            </div>
          </div>
        </div>
      );
    }

    case "quick_actions": {
      return (
        <div className="card cms-quick-actions-section">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "0.75rem",
            }}
          >
            <h3 style={{ margin: 0, fontSize: "1.1rem" }}>
              {section.title || "Quick Actions"}
            </h3>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem" }}>
            {actions?.onOpenCreateModal && (
              <button
                type="button"
                className="btn-primary"
                onClick={actions.onOpenCreateModal}
                style={{ background: "var(--primary-color)" }}
              >
                + New Record
              </button>
            )}
            {actions?.onOpenGenerator && (
              <button
                type="button"
                className="btn-secondary"
                onClick={actions.onOpenGenerator}
              >
                ⚡ Password Generator
              </button>
            )}
            {actions?.vaultUnlocked && actions.onLockVault && (
              <button
                type="button"
                className="btn-secondary"
                onClick={actions.onLockVault}
              >
                🔒 Lock Vault
              </button>
            )}
          </div>
        </div>
      );
    }

    case "recent_items": {
      return (
        <div className="card cms-recent-items-section">
          <h3 style={{ margin: "0 0 0.5rem", fontSize: "1.1rem" }}>
            {section.title || "Recent Activity"}
          </h3>
          <p
            style={{
              margin: 0,
              color: "var(--xai-mute, #7d8187)",
              fontSize: "0.88rem",
            }}
          >
            Local records are encrypted with AES-256-GCM. Unlocked records
            appear in the vault inventory below.
          </p>
        </div>
      );
    }

    case "vault_cards": {
      return (
        <div className="card cms-vault-cards-section">
          <h3 style={{ margin: "0 0 1rem", fontSize: "1.1rem" }}>
            {section.title || "Vault Categories"}
          </h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
              gap: "0.75rem",
            }}
          >
            {["Passwords", "Secure Notes", "Identities", "Payment Cards"].map(
              (cat) => (
                <div
                  key={cat}
                  style={{
                    padding: "0.85rem",
                    background: "var(--xai-canvas-soft, #1a1c20)",
                    border: "1px solid var(--xai-hairline, #212327)",
                    borderRadius: "8px",
                    textAlign: "center",
                  }}
                >
                  <div
                    style={{
                      fontWeight: 400,
                      fontSize: "0.9rem",
                      color: "var(--xai-ink, #ffffff)",
                    }}
                  >
                    {cat}
                  </div>
                  <div
                    style={{
                      fontSize: "0.75rem",
                      color: "var(--xai-mute, #7d8187)",
                      marginTop: "0.2rem",
                      fontFamily: "var(--font-mono)",
                    }}
                  >
                    Encrypted Store
                  </div>
                </div>
              ),
            )}
          </div>
        </div>
      );
    }

    case "custom_info": {
      const text = typeof payload.text === "string" ? payload.text : "";
      return (
        <div
          className="card cms-custom-info-section"
          style={{
            background: "var(--xai-canvas-card, #191919)",
            border: "1px solid rgba(160, 195, 236, 0.35)",
          }}
        >
          <h4
            style={{
              margin: "0 0 0.35rem",
              fontSize: "1rem",
              color: "var(--xai-accent-breeze, #a0c3ec)",
            }}
          >
            {section.title}
          </h4>
          {text && (
            <p
              style={{
                margin: 0,
                fontSize: "0.88rem",
                color: "var(--xai-body, #dadbdf)",
              }}
            >
              {text}
            </p>
          )}
        </div>
      );
    }

    case "help_panel": {
      const helpText =
        typeof payload.text === "string"
          ? payload.text
          : "Your master password derives the Vault Encryption Key client-side and is never sent across the network.";
      return (
        <div
          className="card cms-help-section"
          style={{
            background: "var(--xai-canvas-card, #191919)",
            border: "1px solid rgba(196, 181, 253, 0.35)",
          }}
        >
          <h4
            style={{
              margin: "0 0 0.35rem",
              fontSize: "1rem",
              color: "var(--xai-accent-twilight, #c4b5fd)",
            }}
          >
            💡 {section.title || "Security Tips"}
          </h4>
          <p
            style={{
              margin: 0,
              fontSize: "0.85rem",
              color: "var(--xai-body, #dadbdf)",
            }}
          >
            {helpText}
          </p>
        </div>
      );
    }

    default:
      // Unknown component types are safely ignored without executing code
      return null;
  }
};
