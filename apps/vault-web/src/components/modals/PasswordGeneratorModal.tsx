import React, { useState, useEffect, useCallback } from "react";
import {
  generatePassword,
  estimatePasswordStrength,
} from "../../storage/password-generator";

interface PasswordGeneratorModalProps {
  onCopy: (text: string, label: string) => void;
  onClose: () => void;
}

export const PasswordGeneratorModal: React.FC<PasswordGeneratorModalProps> = ({
  onCopy,
  onClose,
}) => {
  const [length, setLength] = useState(20);
  const [upper, setUpper] = useState(true);
  const [lower, setLower] = useState(true);
  const [numbers, setNumbers] = useState(true);
  const [symbols, setSymbols] = useState(true);
  const [excludeAmbiguous, setExcludeAmbiguous] = useState(true);
  const [password, setPassword] = useState("");

  const refreshPassword = useCallback(() => {
    const generated = generatePassword({
      length,
      uppercase: upper,
      lowercase: lower,
      numbers,
      symbols,
      excludeAmbiguous,
    });
    setPassword(generated);
  }, [length, upper, lower, numbers, symbols, excludeAmbiguous]);

  useEffect(() => {
    refreshPassword();
  }, [refreshPassword]);

  const strength = estimatePasswordStrength(password);

  return (
    <div className="modal-backdrop">
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h3>⚡ Secure Password Generator</h3>
          <button type="button" className="btn-secondary" onClick={onClose}>
            ✕
          </button>
        </div>

        <p
          style={{
            fontSize: "0.85rem",
            color: "var(--xai-mute, #7d8187)",
            margin: "0 0 1rem",
          }}
        >
          Uses Web Crypto CSPRNG with rejection sampling to eliminate modulo
          bias.
        </p>

        {/* Display Box */}
        <div className="generator-display-box">
          <div className="font-mono generated-password-text">{password}</div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <button
              type="button"
              className="btn-icon"
              title="Regenerate"
              onClick={refreshPassword}
            >
              🔄
            </button>
            <button
              type="button"
              className="btn-primary"
              style={{ padding: "0.35rem 0.75rem", fontSize: "0.85rem" }}
              onClick={() => onCopy(password, "Generated Password")}
            >
              📋 Copy
            </button>
          </div>
        </div>

        {/* Strength Meter */}
        <div style={{ margin: "0.75rem 0 1.25rem" }}>
          <div className="strength-bar">
            <div
              className="strength-fill"
              style={{
                width: `${Math.min(100, (strength.entropyBits / 90) * 100)}%`,
                backgroundColor: strength.color,
              }}
            />
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: "0.78rem",
              color: "var(--xai-mute, #7d8187)",
              marginTop: "0.3rem",
            }}
          >
            <span>
              Strength:{" "}
              <strong style={{ color: strength.color }}>
                {strength.label}
              </strong>
            </span>
            <span>~{strength.entropyBits} bits entropy</span>
          </div>
        </div>

        {/* Options */}
        <div className="form-group">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "0.3rem",
            }}
          >
            <label>Length: {length} characters</label>
          </div>
          <input
            type="range"
            min={8}
            max={64}
            value={length}
            onChange={(e) => setLength(parseInt(e.target.value) || 20)}
            style={{ width: "100%", cursor: "pointer" }}
          />
        </div>

        <div className="checkbox-options-grid">
          <label className="checkbox-option">
            <input
              type="checkbox"
              checked={upper}
              onChange={(e) => setUpper(e.target.checked)}
            />
            Uppercase (A-Z)
          </label>

          <label className="checkbox-option">
            <input
              type="checkbox"
              checked={lower}
              onChange={(e) => setLower(e.target.checked)}
            />
            Lowercase (a-z)
          </label>

          <label className="checkbox-option">
            <input
              type="checkbox"
              checked={numbers}
              onChange={(e) => setNumbers(e.target.checked)}
            />
            Numbers (0-9)
          </label>

          <label className="checkbox-option">
            <input
              type="checkbox"
              checked={symbols}
              onChange={(e) => setSymbols(e.target.checked)}
            />
            Symbols (!@#$%^&*)
          </label>

          <label className="checkbox-option" style={{ gridColumn: "span 2" }}>
            <input
              type="checkbox"
              checked={excludeAmbiguous}
              onChange={(e) => setExcludeAmbiguous(e.target.checked)}
            />
            Exclude Ambiguous Characters (l, 1, I, 0, O)
          </label>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              onCopy(password, "Generated Password");
              onClose();
            }}
          >
            Copy & Close
          </button>
        </div>
      </div>
    </div>
  );
};
