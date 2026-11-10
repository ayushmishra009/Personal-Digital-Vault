import { describe, expect, it } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { DashboardView } from "./DashboardView";
import { PasswordsView } from "./PasswordsView";
import { NotesView } from "./NotesView";
import { IdentitiesView } from "./IdentitiesView";
import { PaymentsView } from "./PaymentsView";
import { DocumentsView } from "./DocumentsView";
import { SettingsView } from "./SettingsView";
import { DevicesView } from "./DevicesView";
import { RecoveryView } from "./RecoveryView";
import type {
  PasswordRecord,
  SecureNoteRecord,
  IdentityRecord,
  PaymentRecord,
  DocumentRecord,
} from "@pdv/data-models";
import type { AccountSession, Device, VaultMetadata } from "../api";

describe("Phase 7 Main Web Application Views", () => {
  const dummySession: AccountSession = {
    account: {
      id: "acc-1234",
      email: "user@example.com",
      status: "active",
      createdAt: "2026-11-01T00:00:00Z",
    },
    device: {
      id: "dev-001",
      label: "MacBook Pro",
      platform: "macOS",
      browser: "Chrome",
      status: "active",
      createdAt: "2026-11-01T00:00:00Z",
    },
    authenticatedAt: "2026-11-10T12:00:00Z",
    expiresAt: "2026-11-10T16:00:00Z",
  };

  const dummyVaults: VaultMetadata[] = [
    {
      id: "vault-1111-2222-3333-4444",
      protocolVersion: 1,
      createdAt: "2026-11-01T00:00:00Z",
      updatedAt: "2026-11-01T00:00:00Z",
    },
  ];

  it("DashboardView renders unlocked metrics, security parameters, and recent records", () => {
    const records: PasswordRecord[] = [
      {
        id: "rec-1",
        type: "password",
        title: "Work Email",
        username: "alice@company.com",
        password: "SuperSecretPassword123!",
        url: "https://mail.company.com",
        tags: ["work", "email"],
        createdAt: "2026-11-01T00:00:00Z",
        updatedAt: "2026-11-05T00:00:00Z",
      },
    ];

    const html = renderToString(
      <DashboardView
        appConfig={null}
        vaults={dummyVaults}
        activeVaultId={dummyVaults[0].id}
        isVaultUnlocked={true}
        records={records}
        onUnlockClick={() => {}}
        onCreateVaultClick={() => {}}
        onChangePasswordClick={() => {}}
        onOpenCreateRecord={() => {}}
        onOpenGenerator={() => {}}
        onSelectRecord={() => {}}
        onLockVault={() => {}}
      />,
    );

    expect(html).toContain("Work Email");
    expect(html).toContain("Argon2id v1.3 (p=4, m=64MB, t=3)");
    expect(html).toContain("AES-256-GCM Authenticated");
    expect(html).toContain("Auto-lock active (15 minutes)");
  });

  it("DashboardView renders locked state card when vault is locked", () => {
    const html = renderToString(
      <DashboardView
        appConfig={null}
        vaults={dummyVaults}
        activeVaultId={dummyVaults[0].id}
        isVaultUnlocked={false}
        records={[]}
        onUnlockClick={() => {}}
        onCreateVaultClick={() => {}}
        onChangePasswordClick={() => {}}
        onOpenCreateRecord={() => {}}
        onOpenGenerator={() => {}}
        onSelectRecord={() => {}}
        onLockVault={() => {}}
      />,
    );

    expect(html).toContain("Vault is Locked");
    expect(html).toContain("Unlock with Password");
  });

  it("PasswordsView masks password by default and shows username and URL", () => {
    const records: PasswordRecord[] = [
      {
        id: "pw-1",
        type: "password",
        title: "GitHub Login",
        username: "octocat",
        password: "gh-token-secret-password-xyz",
        url: "https://github.com",
        tags: ["dev", "git"],
        createdAt: "2026-11-01T00:00:00Z",
        updatedAt: "2026-11-01T00:00:00Z",
      },
    ];

    const html = renderToString(
      <PasswordsView
        records={records}
        onOpenCreate={() => {}}
        onOpenEdit={() => {}}
        onDelete={() => {}}
        onCopy={() => {}}
        onOpenGenerator={() => {}}
      />,
    ).replace(/<!-- -->/g, "");

    expect(html).toContain("GitHub Login");
    expect(html).toContain("octocat");
    expect(html).toContain("••••••••••••••••");
    // Plaintext password should be masked in initial server-side render
    expect(html).not.toContain("gh-token-secret-password-xyz");
    expect(html).toContain("https://github.com");
    expect(html).toContain("#dev");
  });

  it("NotesView renders markdown headers and paragraphs safely", () => {
    const notes: SecureNoteRecord[] = [
      {
        id: "note-1",
        type: "secure-note",
        title: "Architecture Strategy",
        content:
          "# Personal Digital Vault\n\nThis note is private.\n- Point 1\n- Point 2",
        tags: ["design"],
        createdAt: "2026-11-01T00:00:00Z",
        updatedAt: "2026-11-01T00:00:00Z",
      },
    ];

    const html = renderToString(
      <NotesView
        records={notes}
        onOpenCreate={() => {}}
        onOpenEdit={() => {}}
        onDelete={() => {}}
        onCopy={() => {}}
      />,
    );

    expect(html).toContain("Architecture Strategy");
    expect(html).toContain("Personal Digital Vault");
    expect(html).toContain("This note is private.");
    expect(html).toContain("Point 1");
  });

  it("IdentitiesView displays masked document numbers and issuing metadata", () => {
    const identities: IdentityRecord[] = [
      {
        id: "id-1",
        type: "identity",
        title: "Alice Passport",
        fields: {
          idType: "Passport",
          fullName: "Alice Smith",
          documentNumber: "P987654321",
          issuingCountry: "United States",
          expiryDate: "2032-05-15",
        },
        tags: ["travel"],
        createdAt: "2026-11-01T00:00:00Z",
        updatedAt: "2026-11-01T00:00:00Z",
      },
    ];

    const html = renderToString(
      <IdentitiesView
        records={identities}
        onOpenCreate={() => {}}
        onOpenEdit={() => {}}
        onDelete={() => {}}
        onCopy={() => {}}
      />,
    );

    expect(html).toContain("Alice Passport");
    expect(html).toContain("Alice Smith");
    expect(html).toContain("United States");
    expect(html).toContain("••••••••••••");
    expect(html).not.toContain("P987654321");
  });

  it("PaymentsView formats card number with brand detection", () => {
    const payments: PaymentRecord[] = [
      {
        id: "pay-1",
        type: "payment",
        title: "Chase Sapphire",
        fields: {
          cardholderName: "ALICE SMITH",
          cardNumber: "4111222233334242",
          expiryMonth: "09",
          expiryYear: "2028",
          cvv: "789",
          billingAddress: "123 Main St, New York, NY",
        },
        tags: ["finance"],
        createdAt: "2026-11-01T00:00:00Z",
        updatedAt: "2026-11-01T00:00:00Z",
      },
    ];

    const html = renderToString(
      <PaymentsView
        records={payments}
        onOpenCreate={() => {}}
        onOpenEdit={() => {}}
        onDelete={() => {}}
        onCopy={() => {}}
      />,
    );

    expect(html).toContain("Chase Sapphire");
    expect(html).toContain("VISA");
    expect(html).toContain("•••• •••• •••• 4242");
    expect(html).not.toContain("4111222233334242");
    expect(html).toContain("ALICE SMITH");
    expect(html).toContain("09/28");
  });

  it("DocumentsView shows attachment placeholder notice and category badges", () => {
    const docs: DocumentRecord[] = [
      {
        id: "doc-1",
        type: "document",
        title: "Tax Return 2025",
        attachmentIds: ["att-001", "att-002"],
        tags: ["taxes", "official"],
        createdAt: "2026-11-01T00:00:00Z",
        updatedAt: "2026-11-01T00:00:00Z",
      },
    ];

    const html = renderToString(
      <DocumentsView
        records={docs}
        onOpenCreate={() => {}}
        onOpenEdit={() => {}}
        onDelete={() => {}}
      />,
    ).replace(/<!-- -->/g, "");

    expect(html).toContain("Tax Return 2025");
    expect(html).toContain("2 files attached");
    expect(html).toContain("Phase 9");
  });

  it("SettingsView renders account info and security preferences", () => {
    const html = renderToString(
      <SettingsView
        session={dummySession}
        theme={{
          themePreset: "default",
          primaryColor: "#1c5230",
          borderRadius: "8px",
          density: "comfortable",
        }}
        onUpdateTheme={() => {}}
        inactivityTimeoutMinutes={15}
        onChangeInactivityTimeout={() => {}}
        onClearLocalCache={() => {}}
      />,
    );

    expect(html).toContain("user@example.com");
    expect(html).toContain("Inactivity Auto-Lock Timeout");
    expect(html).toContain("pdv_local_store");
  });

  it("DevicesView renders active and pending device lists", () => {
    const devices: Device[] = [
      dummySession.device!,
      {
        id: "dev-pending-002",
        label: "iPhone 15",
        platform: "iOS",
        browser: "Mobile Safari",
        status: "pending",
        createdAt: "2026-11-10T13:00:00Z",
      },
    ];

    const html = renderToString(
      <DevicesView
        devices={devices}
        currentDeviceId="dev-001"
        onApproveDevice={async () => {}}
        onRevokeDevice={async () => {}}
        onCreateEnrollment={async () => null}
      />,
    );

    expect(html).toContain("MacBook Pro");
    expect(html).toContain("Current Device");
    expect(html).toContain("Pending Device Enrollments");
    expect(html).toContain("iPhone 15");
  });

  it("RecoveryView renders emergency recovery test and backup options", () => {
    const html = renderToString(
      <RecoveryView
        vaults={dummyVaults}
        activeVaultId={dummyVaults[0].id}
        onExportBackup={async () => {}}
        onImportBackup={async () => {}}
      />,
    );

    expect(html).toContain("Verify Emergency Recovery Secret");
    expect(html).toContain("Export Encrypted JSON Archive");
    expect(html).toContain("Import Encrypted JSON Archive");
  });
});
