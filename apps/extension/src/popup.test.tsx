import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { Popup } from "../entrypoints/popup/Popup";

// Mock wxt/browser runtime messaging
vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      sendMessage: vi.fn().mockImplementation(async (msg: { type: string }) => {
        if (msg.type === "GET_STATUS") {
          return {
            success: true,
            data: {
              isAuthenticated: true,
              isUnlocked: false,
              activeVaultId: null,
              currentTabUrl: "https://example.com/login",
              currentDomain: "example.com",
            },
          };
        }
        return { success: true };
      }),
    },
  },
}));

describe("Popup UI Component", () => {
  it("renders locked view with master password input and unlock button", () => {
    const html = renderToString(<Popup />);
    expect(html).toContain("Personal Vault");
    expect(html).toContain("Vault is Locked");
    expect(html).toContain("Master Password");
    expect(html).toContain("Unlock Vault");
    expect(html).toContain("Seed Demo Vault");
  });
});
