import { describe, it, expect, beforeEach, vi } from "vitest";
import { importVek, sealObject } from "@pdv/crypto-core";
import { SyncEngine, type ActiveConflict } from "./sync-engine";
import { EncryptedRecordRepository } from "./record-repository";
import { MemoryDatabase, setLocalDatabaseForTesting } from "./db";
import type { PasswordRecord, EncryptedObjectEnvelope } from "@pdv/data-models";
import * as api from "../api";

describe("SyncEngine", () => {
  let db: MemoryDatabase;
  let repo: EncryptedRecordRepository;
  let engine: SyncEngine;
  let mockKey: CryptoKey;

  beforeEach(async () => {
    db = new MemoryDatabase();
    setLocalDatabaseForTesting(db);
    repo = new EncryptedRecordRepository();
    engine = new SyncEngine(repo);

    const rawKey = crypto.getRandomValues(new Uint8Array(32));
    mockKey = await importVek(rawKey);
  });

  it("initializes with idle status and empty conflicts", () => {
    expect(engine.getStatus()).toBe("idle");
    expect(engine.getConflicts()).toEqual([]);
  });

  it("pulls remote events and applies them locally", async () => {
    const vaultId = "11111111-1111-4111-8111-111111111111";
    const objectId = "22222222-2222-4222-8222-222222222222";

    const saved = await repo.saveRecord(vaultId, mockKey, {
      id: objectId,
      title: "Remote Record",
      type: "password",
      username: "alice",
      password: "secretpassword123",
      tags: ["work"],
      createdAt: "2026-11-10T00:00:00Z",
      updatedAt: "2026-11-10T00:00:00Z",
    } as PasswordRecord);

    // Mock API calls
    vi.spyOn(api, "listSyncEvents").mockResolvedValueOnce({
      items: [
        {
          sequenceId: "1",
          operationId: "33333333-3333-4333-8333-333333333333",
          deviceId: "44444444-4444-4444-8444-444444444444",
          objectId,
          operationKind: "upsert",
          baseRevision: 0,
          newRevision: 1,
          createdAt: "2026-11-10T00:00:00Z",
        },
      ],
      nextCursor: "1",
      hasMore: false,
    });

    vi.spyOn(api, "getEncryptedObject").mockResolvedValueOnce(saved.envelope);
    vi.spyOn(api, "submitSyncOperation").mockResolvedValue({
      operationId: "55555555-5555-4555-8555-555555555555",
      sequenceId: "2",
      currentRevision: 1,
      accepted: true,
    });

    const result = await engine.syncVault(vaultId, mockKey);

    expect(result.pulledEvents).toBe(1);
    expect(engine.getStatus()).toBe("idle");

    const syncState = await repo.getSyncState(vaultId);
    expect(syncState?.lastSyncSequence).toBe("1");
  });

  it("detects 409 Conflict and records active conflict details", async () => {
    const vaultId = "11111111-1111-4111-8111-111111111111";
    const objectId = "22222222-2222-4222-8222-222222222222";

    // 1. Save local record (enqueues pending op)
    const localSaved = await repo.saveRecord(
      vaultId,
      mockKey,
      {
        id: objectId,
        title: "My Local Title",
        type: "password",
        username: "alice",
        password: "localpassword",
        tags: [],
        createdAt: "2026-11-10T00:00:00Z",
        updatedAt: "2026-11-10T00:00:00Z",
      } as PasswordRecord,
      0, // baseRevision: 0
    );

    // 2. Prepare remote record envelope (sealed directly without overwriting local db)
    const remoteEnvelope = (await sealObject(
      mockKey,
      {
        protocolVersion: 1,
        vaultId,
        objectId,
        revision: 2,
        payloadVersion: 1,
        purpose: "vault-record",
      },
      {
        id: objectId,
        title: "Server Version Title",
        type: "password",
        username: "alice",
        password: "remotepassword",
        tags: [],
        createdAt: "2026-11-10T00:00:00Z",
        updatedAt: "2026-11-10T00:00:00Z",
      },
    )) as EncryptedObjectEnvelope;

    vi.spyOn(api, "listSyncEvents").mockResolvedValueOnce({
      items: [],
      nextCursor: "0",
      hasMore: false,
    });

    // Mock submitSyncOperation throwing 409 ConflictError
    vi.spyOn(api, "submitSyncOperation").mockRejectedValueOnce(
      new api.ConflictError("Revision conflict", {
        currentRevision: 1,
        attemptedBaseRevision: 0,
        objectId,
      }),
    );

    vi.spyOn(api, "getEncryptedObject").mockResolvedValueOnce(remoteEnvelope);

    const result = await engine.syncVault(vaultId, mockKey);

    expect(engine.getStatus()).toBe("conflict");
    expect(result.conflicts.length).toBe(1);

    const conflict = result.conflicts[0];
    expect(conflict.objectId).toBe(objectId);
    expect(conflict.localRecord?.title).toBe("My Local Title");
    expect(conflict.remoteRecord?.title).toBe("Server Version Title");
    expect(conflict.localRevision).toBe(0);
    expect(conflict.remoteRevision).toBe(1);
    expect(localSaved).toBeDefined();
  });

  it("resolves conflict by keeping local version rebased on remote revision", async () => {
    const vaultId = "11111111-1111-4111-8111-111111111111";
    const objectId = "22222222-2222-4222-8222-222222222222";

    const conflict: ActiveConflict = {
      objectId,
      localRecord: {
        id: objectId,
        title: "Local Title",
        type: "password",
        username: "alice",
        password: "pw",
        tags: [],
        createdAt: "2026-11-10T00:00:00Z",
        updatedAt: "2026-11-10T00:00:00Z",
      } as PasswordRecord,
      remoteRecord: null,
      localRevision: 0,
      remoteRevision: 1,
      attemptedOperationId: "33333333-3333-4333-8333-333333333333",
    };

    // Put failed pending op
    await db.putPendingOperation({
      operationId: "33333333-3333-4333-8333-333333333333",
      objectId,
      kind: "upsert",
      baseRevision: 0,
      clientCreatedAt: new Date().toISOString(),
      envelope: {} as unknown as EncryptedObjectEnvelope,
    });

    await engine.resolveKeepLocal(vaultId, mockKey, conflict);

    const pending = await db.listPendingOperations(vaultId);
    expect(
      pending.some(
        (p) => p.operationId === "33333333-3333-4333-8333-333333333333",
      ),
    ).toBe(false);
    expect(
      pending.some((p) => p.objectId === objectId && p.baseRevision === 1),
    ).toBe(true);
    expect(engine.getConflicts().length).toBe(0);
  });

  it("resolves conflict by accepting remote version (discards local edit)", async () => {
    const vaultId = "11111111-1111-4111-8111-111111111111";
    const objectId = "22222222-2222-4222-8222-222222222222";

    const conflict: ActiveConflict = {
      objectId,
      localRecord: null,
      remoteRecord: null,
      localRevision: 0,
      remoteRevision: 1,
      attemptedOperationId: "44444444-4444-4444-8444-444444444444",
    };

    await db.putPendingOperation({
      operationId: "44444444-4444-4444-8444-444444444444",
      objectId,
      kind: "upsert",
      baseRevision: 0,
      clientCreatedAt: new Date().toISOString(),
      envelope: {} as unknown as EncryptedObjectEnvelope,
    });

    await engine.resolveKeepRemote(vaultId, conflict);

    const pending = await db.listPendingOperations(vaultId);
    expect(
      pending.some(
        (p) => p.operationId === "44444444-4444-4444-8444-444444444444",
      ),
    ).toBe(false);
    expect(engine.getConflicts().length).toBe(0);
  });
});
