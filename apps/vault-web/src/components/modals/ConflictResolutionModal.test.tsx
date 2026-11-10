import { describe, it, expect, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { ConflictResolutionModal } from "./ConflictResolutionModal";
import type { ActiveConflict } from "../../storage/sync-engine";
import type { PasswordRecord } from "@pdv/data-models";

describe("ConflictResolutionModal", () => {
  const dummyConflict: ActiveConflict = {
    objectId: "11111111-2222-3333-4444-555555555555",
    localRevision: 1,
    remoteRevision: 2,
    attemptedOperationId: "op-1234",
    localRecord: {
      id: "11111111-2222-3333-4444-555555555555",
      title: "Local Bank Login",
      type: "password",
      username: "alice_local",
      password: "secret_local_password",
      tags: ["finance"],
      createdAt: "2026-11-10T00:00:00Z",
      updatedAt: "2026-11-10T12:00:00Z",
    } as PasswordRecord,
    remoteRecord: {
      id: "11111111-2222-3333-4444-555555555555",
      title: "Remote Bank Login",
      type: "password",
      username: "alice_remote",
      password: "secret_remote_password",
      tags: ["finance", "important"],
      createdAt: "2026-11-10T00:00:00Z",
      updatedAt: "2026-11-10T12:30:00Z",
    } as PasswordRecord,
  };

  it("renders conflict warning and side-by-side comparison", () => {
    const html = renderToString(
      <ConflictResolutionModal
        conflict={dummyConflict}
        onKeepLocal={vi.fn()}
        onKeepRemote={vi.fn()}
        onMerge={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain("Revision Conflict Detected");
    expect(html).toContain("Your Local Version");
    expect(html).toContain("Remote Server Version");
    expect(html).toContain("Local Bank Login");
    expect(html).toContain("Remote Bank Login");
    expect(html).toContain("Keep My Local Version");
    expect(html).toContain("Accept Server Version");
    expect(html).toContain("Manually Merge Versions");
  });

  it("renders empty state placeholder when remote record is deleted", () => {
    const deletedConflict: ActiveConflict = {
      ...dummyConflict,
      remoteRecord: null,
    };

    const html = renderToString(
      <ConflictResolutionModal
        conflict={deletedConflict}
        onKeepLocal={vi.fn()}
        onKeepRemote={vi.fn()}
        onMerge={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(html.replace(/<!-- -->/g, "")).toContain(
      "Record was deleted or unavailable (Revision 2)",
    );
  });
});
