import { defineContentScript } from "wxt/utils/define-content-script";
import { browser } from "wxt/browser";
import {
  fillCredentialsInDocument,
  fillGeneratedPasswordInDocument,
  captureCredentialsFromDocument,
  setInputValue,
} from "../src/utils/dom-fill";
import { generatePassword } from "../src/utils/password-generator";
import type { CapturedCredential } from "../src/types";

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  allFrames: false, // Strictly top-level frame only! Rejects injection into cross-origin iframes
  runAt: "document_idle",
  main() {
    let activePromptHost: HTMLElement | null = null;
    let inlineButtonHost: HTMLElement | null = null;
    let isHoveringPill = false;
    let currentFocusedInput: HTMLInputElement | null = null;

    // 1. Listen for messages from extension background
    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === "PDV_FILL_CREDENTIALS") {
        const { username, password } = message.payload || {};
        const result = fillCredentialsInDocument(document, username, password);
        sendResponse(result);
        return true;
      }

      if (message.type === "PDV_FILL_GENERATED_PASSWORD") {
        const { password } = message.payload || {};
        const result = fillGeneratedPasswordInDocument(
          document,
          password,
          currentFocusedInput,
        );
        sendResponse(result);
        return true;
      }

      if (message.type === "PDV_DETECT_FORM") {
        const hasInputs = !!(
          document.querySelector('input[type="password"]') ||
          document.querySelector('input[autocomplete*="password"]')
        );
        sendResponse({ hasLoginForm: hasInputs });
        return true;
      }

      if (message.type === "PDV_SHOW_SAVE_PROMPT") {
        showSavePromptBanner(message.payload);
        sendResponse({ success: true });
        return true;
      }
    });

    // Helper: detect if an element is a password/registration field
    function isPasswordField(el: Element | null): el is HTMLInputElement {
      if (!el || el.tagName !== "INPUT") return false;
      const input = el as HTMLInputElement;
      const type = (input.getAttribute("type") || input.type || "").toLowerCase();
      const autocomplete = (input.getAttribute("autocomplete") || "").toLowerCase();
      const name = (input.name || "").toLowerCase();
      const id = (input.id || "").toLowerCase();

      return (
        type === "password" ||
        autocomplete === "new-password" ||
        autocomplete === "current-password" ||
        name.includes("password") ||
        name.includes("passwd") ||
        id.includes("password") ||
        id.includes("passwd")
      );
    }

    // 2. Inline Suggestion Button
    function createInlineButtonHost(): { host: HTMLElement; shadow: ShadowRoot } {
      if (inlineButtonHost && inlineButtonHost.parentNode) {
        return { host: inlineButtonHost, shadow: inlineButtonHost.shadowRoot! };
      }
      const host = document.createElement("div");
      host.id = "pdv-inline-button-host";
      host.style.position = "fixed";
      host.style.zIndex = "2147483647";
      host.style.pointerEvents = "auto";
      const shadow = host.attachShadow({ mode: "open" });

      host.addEventListener("mouseenter", () => {
        isHoveringPill = true;
      });
      host.addEventListener("mouseleave", () => {
        isHoveringPill = false;
      });

      document.body.appendChild(host);
      inlineButtonHost = host;
      return { host, shadow };
    }

    function removeInlineButton(): void {
      if (isHoveringPill) return;
      if (inlineButtonHost && inlineButtonHost.parentNode) {
        inlineButtonHost.parentNode.removeChild(inlineButtonHost);
        inlineButtonHost = null;
      }
    }

    function positionInlinePill(target: HTMLInputElement): void {
      if (!inlineButtonHost) return;
      const rect = target.getBoundingClientRect();
      if (
        rect.width === 0 ||
        rect.height === 0 ||
        rect.bottom < 0 ||
        rect.top > window.innerHeight
      ) {
        inlineButtonHost.style.display = "none";
        return;
      }

      inlineButtonHost.style.display = "block";
      let top = rect.bottom + 4;
      if (top + 32 > window.innerHeight) {
        top = Math.max(4, rect.top - 32);
      }
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - 220));

      inlineButtonHost.style.top = `${top}px`;
      inlineButtonHost.style.left = `${left}px`;
    }

    function attachInlinePasswordSuggester(): void {
      const showPillForInput = (target: HTMLInputElement) => {
        currentFocusedInput = target;
        const { shadow } = createInlineButtonHost();
        positionInlinePill(target);

        shadow.innerHTML = `
          <style>
            .pdv-pill {
              display: inline-flex;
              align-items: center;
              gap: 6px;
              padding: 5px 12px;
              background: #0a0a0a;
              border: 1px solid #272a30;
              border-radius: 9999px;
              color: #f5f5f5;
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              font-size: 11px;
              font-weight: 500;
              cursor: pointer;
              box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45);
              transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1);
              user-select: none;
              white-space: nowrap;
            }
            .pdv-pill:hover {
              background: #14171a;
              border-color: #3b82f6;
              color: #ffffff;
              transform: translateY(-1px);
            }
            .pdv-icon {
              width: 12px;
              height: 12px;
              color: #3b82f6;
            }
          </style>
          <button type="button" class="pdv-pill">
            <svg class="pdv-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
            <span>Suggest Strong Password</span>
          </button>
        `;

        const btn = shadow.querySelector("button");
        if (btn) {
          // Use mousedown with preventDefault so clicking the pill doesn't blur the input
          btn.addEventListener("mousedown", (e) => {
            e.preventDefault();
            e.stopPropagation();
          });

          btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();

            try {
              // 1. Generate strong password synchronously
              const password = generatePassword({ length: 20 });

              // 2. Fill focused password input
              setInputValue(target, password);

              // 3. Fill confirmation password field on the same form if present
              let confirmFilled = false;
              if (target.form) {
                const otherPasswordInputs = Array.from(
                  target.form.querySelectorAll<HTMLInputElement>(
                    'input[type="password"], input[autocomplete="new-password"], input[name*="pass" i], input[id*="pass" i]',
                  ),
                ).filter((inp) => inp !== target);

                for (const other of otherPasswordInputs) {
                  setInputValue(other, password);
                  confirmFilled = true;
                }
              }

              // 4. Extract username and stage credentials for auto-save
              const captured = captureCredentialsFromDocument(document, target.form);
              const cred: CapturedCredential = {
                username: captured?.username || "",
                password,
                url: window.location.href,
                title: document.title || window.location.hostname,
                timestamp: Date.now(),
              };

              browser.runtime
                .sendMessage({
                  type: "CAPTURE_CREDENTIALS",
                  data: cred,
                })
                .catch(() => {});

              // 5. Update UI feedback
              btn.innerHTML = confirmFilled
                ? "<span>✓ Password & Confirm Filled!</span>"
                : "<span>✓ Strong Password Filled!</span>";

              // 6. Display floating Save Prompt Banner so user can save immediately
              showSavePromptBanner(cred);

              setTimeout(() => {
                isHoveringPill = false;
                removeInlineButton();
              }, 1800);
            } catch {
              btn.innerHTML = "<span>Error filling</span>";
              setTimeout(() => removeInlineButton(), 1500);
            }
          });
        }
      };

      document.addEventListener("focusin", (e) => {
        const target = e.target as HTMLInputElement | null;
        if (!isPasswordField(target)) return;
        showPillForInput(target);
      });

      document.addEventListener("click", (e) => {
        const target = e.target as HTMLInputElement | null;
        if (!isPasswordField(target)) return;
        showPillForInput(target);
      });

      document.addEventListener("focusout", () => {
        setTimeout(() => {
          if (isHoveringPill) return;
          const activeEl = document.activeElement;
          if (!isPasswordField(activeEl)) {
            removeInlineButton();
          }
        }, 200);
      });

      // Update position dynamically on scroll or window resize
      const updatePos = () => {
        if (currentFocusedInput && inlineButtonHost) {
          positionInlinePill(currentFocusedInput);
        }
      };
      window.addEventListener("scroll", updatePos, { passive: true, capture: true });
      window.addEventListener("resize", updatePos, { passive: true });
    }

    // 3. Form Submission Capture
    function handleFormCapture(form?: HTMLFormElement | null): void {
      const captured = captureCredentialsFromDocument(document, form);
      if (!captured || !captured.password) return;

      const cred: CapturedCredential = {
        username: captured.username || "",
        password: captured.password,
        url: window.location.href,
        title: document.title || window.location.hostname,
        timestamp: Date.now(),
      };

      // Notify background worker
      browser.runtime
        .sendMessage({
          type: "CAPTURE_CREDENTIALS",
          data: cred,
        })
        .catch(() => {});

      // Show floating in-page prompt
      showSavePromptBanner(cred);
    }

    function attachFormListeners(): void {
      document.addEventListener(
        "submit",
        (e) => {
          handleFormCapture(e.target as HTMLFormElement);
        },
        true,
      );

      document.addEventListener(
        "click",
        (e) => {
          const target = e.target as HTMLElement | null;
          if (!target) return;
          const submitBtn = target.closest(
            'button[type="submit"], input[type="submit"]',
          );
          if (submitBtn) {
            const form = submitBtn.closest("form");
            handleFormCapture(form);
          }
        },
        true,
      );
    }

    // 4. In-Page Floating Save Prompt Banner
    function showSavePromptBanner(cred: CapturedCredential): void {
      if (activePromptHost && activePromptHost.parentNode) {
        activePromptHost.parentNode.removeChild(activePromptHost);
        activePromptHost = null;
      }

      const host = document.createElement("div");
      host.id = "pdv-save-prompt-root";
      host.style.position = "fixed";
      host.style.top = "16px";
      host.style.right = "16px";
      host.style.zIndex = "2147483647";
      const shadow = host.attachShadow({ mode: "open" });

      const hostname = window.location.hostname;

      shadow.innerHTML = `
        <style>
          .pdv-card {
            width: 320px;
            background: #0a0a0a;
            border: 1px solid #212327;
            border-radius: 12px;
            padding: 16px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6), 0 1px 3px rgba(0, 0, 0, 0.4);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: #f5f5f5;
            box-sizing: border-box;
            animation: slideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1);
          }
          @keyframes slideIn {
            from { opacity: 0; transform: translateY(-10px) scale(0.96); }
            to { opacity: 1; transform: translateY(0) scale(1); }
          }
          .pdv-header {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 12px;
          }
          .pdv-shield-badge {
            width: 28px;
            height: 28px;
            border-radius: 6px;
            background: #14171a;
            border: 1px solid #272a30;
            display: flex;
            align-items: center;
            justify-content: center;
            color: #f5f5f5;
          }
          .pdv-title {
            font-size: 13px;
            font-weight: 600;
            color: #f5f5f5;
            margin: 0;
          }
          .pdv-subtitle {
            font-size: 11px;
            color: #888888;
            margin: 0;
          }
          .pdv-field-row {
            margin-bottom: 10px;
          }
          .pdv-label {
            display: block;
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #71767b;
            margin-bottom: 4px;
          }
          .pdv-input {
            width: 100%;
            background: #14171a;
            border: 1px solid #272a30;
            border-radius: 6px;
            padding: 6px 10px;
            font-size: 12px;
            color: #f5f5f5;
            box-sizing: border-box;
            outline: none;
          }
          .pdv-input:focus {
            border-color: #3b82f6;
          }
          .pdv-actions {
            display: flex;
            align-items: center;
            justify-content: flex-end;
            gap: 8px;
            margin-top: 14px;
          }
          .pdv-btn {
            border-radius: 9999px;
            font-size: 12px;
            font-weight: 500;
            padding: 6px 14px;
            cursor: pointer;
            transition: all 0.15s ease;
          }
          .pdv-btn-dismiss {
            background: transparent;
            border: 1px solid #272a30;
            color: #888888;
          }
          .pdv-btn-dismiss:hover {
            color: #f5f5f5;
            background: #16181c;
          }
          .pdv-btn-save {
            background: #f5f5f5;
            border: 1px solid #f5f5f5;
            color: #0a0a0a;
            font-weight: 600;
          }
          .pdv-btn-save:hover {
            background: #e5e5e5;
          }
          .pdv-status {
            font-size: 11px;
            margin-top: 8px;
            display: none;
          }
        </style>
        <div class="pdv-card">
          <div class="pdv-header">
            <div class="pdv-shield-badge">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              </svg>
            </div>
            <div>
              <div class="pdv-title">Save to Personal Vault?</div>
              <div class="pdv-subtitle">${hostname}</div>
            </div>
          </div>
          <div class="pdv-field-row">
            <label class="pdv-label">Username / Email</label>
            <input type="text" class="pdv-input pdv-username" value="${cred.username || ""}" placeholder="Username" />
          </div>
          <div class="pdv-field-row">
            <label class="pdv-label">Password</label>
            <input type="password" class="pdv-input pdv-password" value="${cred.password || ""}" />
          </div>
          <div class="pdv-status"></div>
          <div class="pdv-actions">
            <button type="button" class="pdv-btn pdv-btn-dismiss">Not Now</button>
            <button type="button" class="pdv-btn pdv-btn-save">Save to Vault</button>
          </div>
        </div>
      `;

      document.body.appendChild(host);
      activePromptHost = host;

      const dismissBtn = shadow.querySelector<HTMLButtonElement>(".pdv-btn-dismiss");
      const saveBtn = shadow.querySelector<HTMLButtonElement>(".pdv-btn-save");
      const usernameInput = shadow.querySelector<HTMLInputElement>(".pdv-username");
      const passwordInput = shadow.querySelector<HTMLInputElement>(".pdv-password");
      const statusEl = shadow.querySelector<HTMLDivElement>(".pdv-status");

      dismissBtn?.addEventListener("click", () => {
        if (host.parentNode) host.parentNode.removeChild(host);
        activePromptHost = null;
      });

      saveBtn?.addEventListener("click", async () => {
        if (!saveBtn) return;
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving...";

        try {
          const res = await browser.runtime.sendMessage({
            type: "SAVE_CREDENTIAL",
            title: cred.title || hostname,
            url: cred.url,
            username: usernameInput?.value || cred.username,
            password: passwordInput?.value || cred.password,
            tags: ["auto-captured"],
          });

          if (res?.success) {
            saveBtn.textContent = "✓ Saved";
            if (statusEl) {
              statusEl.style.display = "block";
              statusEl.style.color = "#10b981";
              statusEl.textContent = "Securely encrypted & saved to your vault.";
            }
            setTimeout(() => {
              if (host.parentNode) host.parentNode.removeChild(host);
              activePromptHost = null;
            }, 2000);
          } else {
            saveBtn.disabled = false;
            saveBtn.textContent = "Save to Vault";
            if (statusEl) {
              statusEl.style.display = "block";
              statusEl.style.color = "#ef4444";
              statusEl.textContent = res?.error || "Unlock vault to save.";
            }
          }
        } catch {
          saveBtn.disabled = false;
          saveBtn.textContent = "Save to Vault";
        }
      });
    }

    // Initialize content script listeners
    attachInlinePasswordSuggester();
    attachFormListeners();
  },
});
