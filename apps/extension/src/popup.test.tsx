import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { browser } from "wxt/browser";
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

  it("renders unlocked tabs with Credentials, Generator, and Allowed Origins", () => {
    const originalMock = vi.mocked(browser.runtime.sendMessage);
    originalMock.mockImplementation(async (msg: unknown) => {
      const message = msg as { type: string };
      if (message.type === "GET_STATUS") {
        return {
          success: true,
          data: {
            isAuthenticated: true,
            isUnlocked: true,
            activeVaultId: "v-1",
            currentTabUrl: "https://example.com/login",
            currentDomain: "example.com",
          },
        };
      }
      if (message.type === "LIST_CREDENTIALS") {
        return { success: true, data: [] };
      }
      if (message.type === "GET_PENDING_CAPTURE") {
        return {
          success: true,
          data: {
            username: "detected_user",
            password: "secret_password",
            url: "https://example.com/signup",
            title: "Example Signup",
            timestamp: Date.now(),
          },
        };
      }
      return { success: true, data: [] };
    });

    const html = renderToString(
      <Popup
        initialStatus={{
          isAuthenticated: true,
          isUnlocked: true,
          activeVaultId: "v-1",
          currentTabUrl: "https://example.com/login",
          currentDomain: "example.com",
        }}
      />,
    );
    expect(html).toContain("Credentials");
    expect(html).toContain("Generator");
    expect(html).toContain("Allowed Origins");
  });
});
