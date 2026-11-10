import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { RestoreStagingModal } from "./RestoreStagingModal";
import type { StagedRestorePlan } from "@pdv/data-models";

describe("RestoreStagingModal", () => {
  const dummyPlan: StagedRestorePlan = {
    vaultId: "11111111-2222-3333-4444-555555555555",
    snapshotId: "99999999-8888-7777-6666-555555555555",
    createdAt: "2026-11-10T12:00:00Z",
    summary: {
      newCount: 1,
      upgradedCount: 1,
      identicalCount: 1,
      conflictCount: 1,
    },
    attachments: [
      {
        attachmentId: "att-1",
        ciphertextSize: 55,
        ciphertextDigest: "mock-digest",
        updatedAt: "2026-11-10T12:00:00Z",
      },
    ],
    items: [
      {
        objectId: "rec-1",
        title: "New Bank Card",
        type: "payment",
        status: "new",
        backupRevision: 1,
        record: {
          id: "rec-1",
          type: "payment",
          title: "New Bank Card",
          tags: [],
          fields: {},
          createdAt: "2026-11-10T12:00:00Z",
          updatedAt: "2026-11-10T12:00:00Z",
        },
        envelope: {
          protocolVersion: 1,
          algorithm: "AES-256-GCM",
          keyWrapAlgorithm: "AES-256-KW",
          vaultId: "11111111-2222-3333-4444-555555555555",
          objectId: "rec-1",
          revision: 1,
          payloadVersion: 1,
          purpose: "vault-record",
          nonce: "AAAA",
          wrappedDek: "BBBB",
          ciphertext: "CCCC",
        },
      },
      {
        objectId: "rec-2",
        title: "Work Email",
        type: "password",
        status: "conflict_older",
        backupRevision: 1,
        localRevision: 3,
        record: {
          id: "rec-2",
          type: "password",
          title: "Work Email",
          password: "older-pass",
          tags: [],
          createdAt: "2026-11-10T12:00:00Z",
          updatedAt: "2026-11-10T12:00:00Z",
        },
        envelope: {
          protocolVersion: 1,
          algorithm: "AES-256-GCM",
          keyWrapAlgorithm: "AES-256-KW",
          vaultId: "11111111-2222-3333-4444-555555555555",
          objectId: "rec-2",
          revision: 1,
          payloadVersion: 1,
          purpose: "vault-record",
          nonce: "AAAA",
          wrappedDek: "BBBB",
          ciphertext: "CCCC",
        },
      },
    ],
  };

  it("renders staging summary badges and conflict safeguards", () => {
    const html = renderToString(
      <RestoreStagingModal
        plan={dummyPlan}
        onConfirmRestore={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain("Review Backup Restore Staging");
    expect(html).toContain("New Records");
    expect(html).toContain("Upgrades");
    expect(html).toContain("Conflicts");
    expect(html).toContain("Restore Conflict Safeguard");
    expect(html).toContain("Force overwrite newer local records");
    expect(html).toContain("New Bank Card");
    expect(html).toContain("Work Email");
    expect(html).toContain("Older Conflict");
  });
});
