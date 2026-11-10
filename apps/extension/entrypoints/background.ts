import { defineBackground } from "wxt/utils/define-background";
import { browser } from "wxt/browser";
import { SessionManager, type StoredVaultData } from "../src/session";
import type { ExtensionMessage } from "../src/types";

export default defineBackground(() => {
  const session = new SessionManager();

  // Load persisted allowlist and stored vault data on service worker startup
  try {
    browser.storage?.local
      ?.get(["pdv_allowlist", "pdv_vault_data"])
      .then((data) => {
        if (data?.pdv_allowlist && Array.isArray(data.pdv_allowlist)) {
          session.setAllowlist(data.pdv_allowlist);
        }
        if (data?.pdv_vault_data) {
          session.setStoredVault(
            data.pdv_vault_data as unknown as StoredVaultData,
          );
        }
      })
      .catch(() => {
        // Storage access error handling
      });
  } catch {
    // Ignore if storage is unavailable in testing environments
  }

  // Handle messages from Popup or options
  browser.runtime.onMessage.addListener(
    (message: ExtensionMessage, _sender, sendResponse) => {
      (async () => {
        try {
          switch (message.type) {
            case "GET_STATUS": {
              const tabs = await browser.tabs.query({
                active: true,
                currentWindow: true,
              });
              const currentTab = tabs[0];
              const status = session.getStatus(currentTab?.url);
              sendResponse({ success: true, data: status });
              break;
            }

            case "UNLOCK_VAULT": {
              const result = await session.unlock({
                password: message.password,
                recoverySecret: message.recoverySecret,
                vaultId: message.vaultId,
              });
              if (result.success && session.getStoredVault()) {
                try {
                  await browser.storage?.local?.set({
                    pdv_vault_data: session.getStoredVault(),
                  });
                } catch {
                  // Ignore storage write error
                }
              }
              sendResponse(result);
              break;
            }

            case "LOCK_VAULT": {
              session.lock();
              sendResponse({ success: true });
              break;
            }

            case "LIST_CREDENTIALS": {
              const tabs = await browser.tabs.query({
                active: true,
                currentWindow: true,
              });
              const currentTab = tabs[0];
              const credentials = session.listCredentials(
                currentTab?.url,
                message.query,
              );
              sendResponse({ success: true, data: credentials });
              break;
            }

            case "CHECK_DOMAIN_MATCH": {
              const tabs = await browser.tabs.query({
                active: true,
                currentWindow: true,
              });
              const currentTab = tabs[0];
              const matchInfo = session.checkDomainMatch(
                message.recordId,
                currentTab?.url,
              );
              sendResponse({ success: true, data: matchInfo });
              break;
            }

            case "REQUEST_FILL": {
              const tabs = await browser.tabs.query({
                active: true,
                currentWindow: true,
              });
              const currentTab = tabs[0];

              if (!currentTab || !currentTab.id) {
                sendResponse({
                  success: false,
                  error: "No active browser tab found",
                });
                break;
              }

              const fillData = session.requestFill(
                message.recordId,
                currentTab.url,
                message.allowMismatch,
              );

              // Forward single credential pair to top-level tab frame only
              // Strictly targeting frameId: 0 to prevent injection into child/cross-origin iframes
              const fillResult = await browser.tabs.sendMessage(
                currentTab.id,
                {
                  type: "PDV_FILL_CREDENTIALS",
                  payload: {
                    username: fillData.username,
                    password: fillData.password,
                  },
                },
                { frameId: 0 },
              );

              sendResponse({ success: true, data: fillResult });
              break;
            }

            case "GET_ALLOWLIST": {
              sendResponse({ success: true, data: session.getAllowlist() });
              break;
            }

            case "ADD_ALLOWLIST": {
              const added = session.addAllowlist(message.domain);
              if (added) {
                try {
                  await browser.storage?.local?.set({
                    pdv_allowlist: session.getAllowlist(),
                  });
                } catch {
                  // Ignore
                }
              }
              sendResponse({ success: added, data: session.getAllowlist() });
              break;
            }

            case "REMOVE_ALLOWLIST": {
              const removed = session.removeAllowlist(message.domain);
              if (removed) {
                try {
                  await browser.storage?.local?.set({
                    pdv_allowlist: session.getAllowlist(),
                  });
                } catch {
                  // Ignore
                }
              }
              sendResponse({ success: removed, data: session.getAllowlist() });
              break;
            }

            case "SEED_VAULT": {
              const vaultData = await session.seedDefaultVault(
                message.password,
              );
              try {
                await browser.storage?.local?.set({
                  pdv_vault_data: vaultData,
                });
              } catch {
                // Ignore
              }
              sendResponse({ success: true, data: vaultData.vaultId });
              break;
            }

            default:
              sendResponse({ success: false, error: "Unknown message type" });
          }
        } catch (err) {
          sendResponse({
            success: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })();

      // Keep message port open for async response
      return true;
    },
  );
});
