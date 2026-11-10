import { describe, expect, it } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { CmsSectionRenderer } from "./CmsSectionRenderer";
import type { CmsSection } from "@pdv/data-models";

describe("CmsSectionRenderer - Declarative Trusted Component Registry", () => {
  it("renders safe welcome banner with zero-knowledge indicator", () => {
    const section: CmsSection = {
      id: "sec-001",
      screenKey: "vault_overview",
      sectionType: "welcome",
      title: "Welcome to Vault",
      contentPayload: {
        greeting: "Welcome Alice",
        subtitle: "Zero-Knowledge Personal Storage",
      },
      styleConfig: {},
      displayOrder: 1,
      isEnabled: true,
    };

    const html = renderToString(<CmsSectionRenderer section={section} />);
    expect(html).toContain("Welcome Alice");
    expect(html).toContain("Zero-Knowledge Personal Storage");
    expect(html).toContain("End-to-End Encrypted");
  });

  it("does not render disabled section", () => {
    const section: CmsSection = {
      id: "sec-002",
      screenKey: "vault_overview",
      sectionType: "welcome",
      title: "Welcome",
      contentPayload: {},
      styleConfig: {},
      displayOrder: 1,
      isEnabled: false,
    };

    const html = renderToString(<CmsSectionRenderer section={section} />);
    expect(html).toBe("");
  });

  it("safely ignores unknown or untrusted section types without executing anything", () => {
    const untrustedSection: CmsSection = {
      id: "sec-untrusted",
      screenKey: "vault_overview",
      sectionType: "arbitrary_executable_block",
      title: "Malicious Component",
      contentPayload: { script: "alert(1)" },
      styleConfig: {},
      displayOrder: 1,
      isEnabled: true,
    };

    const html = renderToString(
      <CmsSectionRenderer section={untrustedSection} />,
    );
    expect(html).toBe("");
  });

  it("escapes all text content and does not permit HTML injection in custom_info", () => {
    const injectSection: CmsSection = {
      id: "sec-inject",
      screenKey: "vault_overview",
      sectionType: "custom_info",
      title: "Notice <img src=x onerror=alert(1)>",
      contentPayload: {
        text: "<script>window.stolenKey = true</script>",
      },
      styleConfig: {},
      displayOrder: 2,
      isEnabled: true,
    };

    const html = renderToString(<CmsSectionRenderer section={injectSection} />);
    // Must be escaped, never raw tags
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain(
      "&lt;script&gt;window.stolenKey = true&lt;/script&gt;",
    );
  });

  it("renders summary section with record counts and cryptographic status", () => {
    const section: CmsSection = {
      id: "sec-sum",
      screenKey: "vault_overview",
      sectionType: "summary",
      title: "Vault Security Status",
      contentPayload: {},
      styleConfig: {},
      displayOrder: 3,
      isEnabled: true,
    };

    const html = renderToString(
      <CmsSectionRenderer
        section={section}
        actions={{ recordCount: 42, vaultUnlocked: true }}
      />,
    );
    expect(html).toContain("42");
    expect(html).toContain("Argon2id (p=4) + AES-256-GCM");
  });
});
