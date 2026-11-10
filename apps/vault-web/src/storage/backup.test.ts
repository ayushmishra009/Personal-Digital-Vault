import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sealObject } from "@pdv/crypto-core";
import { MemoryDatabase } from "./db";
import {
  exportVaultBackup,
  stageVaultBackup,
  applyRestorePlan,
} from "./backup";
import { createVaultKeyEnvelopes } from "../crypto";
import type { PasswordRecord, VaultKeyEnvelope } from "@pdv/data-models";

describe("Phase 10: Backup and Restore Engine", () => {
  const VAULT_ID = "11111111-1111-4111-8111-111111111111";
  const PASSWORD = "SuperSecurePassword2026!";
  let db: MemoryDatabase;
  let vek: CryptoKey;
  let recoverySecret: string;
  let keyEnvelopes: VaultKeyEnvelope[];

  beforeAll(() => {
    // Mock fetch for WASM binary in node test environment
    const wasmPath = resolve(
      __dirname,
      "../../public/pdv_argon2_wasm_candidate.wasm",
    );
    const wasmBytes = readFileSync(wasmPath);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("pdv_argon2_wasm_candidate.wasm")) {
        return new Response(wasmBytes, {
          status: 200,
          headers: { "Content-Type": "application/wasm" },
        });
      }
      return originalFetch(input, init);
    };
  });

  beforeEach(async () => {
    db = new MemoryDatabase();

    const envs = await createVaultKeyEnvelopes(PASSWORD);
    vek = envs.vek;
    recoverySecret = envs.recoverySecret;
    keyEnvelopes = [envs.passwordEnvelope, envs.recoveryEnvelope];

    // Seed db with 2 records
    const rec1Payload: PasswordRecord = {
      id: "aaaa0001-0000-4000-8000-000000000001",
      type: "password",
      title: "Google Workspace",
      password: "google-secret-pass",
      tags: ["work"],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const env1 = await sealObject(
      vek,
      {
        protocolVersion: 1,
        purpose: "vault-record",
        vaultId: VAULT_ID,
        objectId: rec1Payload.id,
        revision: 2,
        payloadVersion: 1,
      },
      rec1Payload,
    );
    await db.putRecord({
      vaultId: VAULT_ID,
      objectId: rec1Payload.id,
      revision: 2,
      payloadVersion: 1,
      envelope: env1,
      updatedAt: rec1Payload.updatedAt,
    });

    const rec2Payload: PasswordRecord = {
      id: "aaaa0002-0000-4000-8000-000000000002",
      type: "password",
      title: "Bank Account",
      password: "bank-secret-pass",
      tags: ["finance"],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const env2 = await sealObject(
      vek,
      {
        protocolVersion: 1,
        purpose: "vault-record",
        vaultId: VAULT_ID,
        objectId: rec2Payload.id,
        revision: 1,
        payloadVersion: 1,
      },
      rec2Payload,
    );
    await db.putRecord({
      vaultId: VAULT_ID,
      objectId: rec2Payload.id,
      revision: 1,
      payloadVersion: 1,
      envelope: env2,
      updatedAt: rec2Payload.updatedAt,
    });

    // Seed 1 attachment
    await db.putAttachment({
      vaultId: VAULT_ID,
      attachmentId: "bbbb0001-0000-4000-8000-000000000001",
      ciphertext: new Uint8Array([1, 2, 3, 4, 5]),
      ciphertextSize: 5,
      ciphertextDigest: "mock-attachment-digest",
      updatedAt: new Date().toISOString(),
    });
  });

  it("exports a valid encrypted backup archive package with integrity manifest", async () => {
    const {
      package: pkg,
      jsonString,
      blob,
    } = await exportVaultBackup({
      vaultId: VAULT_ID,
      vek,
      keyEnvelopes,
      db,
    });

    expect(pkg.formatVersion).toBe(1);
    expect(pkg.protocolVersion).toBe(1);
    expect(pkg.algorithm).toBe("AES-256-GCM");
    expect(pkg.vaultId).toBe(VAULT_ID);
    expect(pkg.manifestSummary.recordCount).toBe(2);
    expect(pkg.manifestSummary.attachmentCount).toBe(1);
    expect(pkg.manifestSummary.rootHash.length).toBeGreaterThanOrEqual(32);
    expect(pkg.ciphertext.length).toBeGreaterThan(0);
    expect(jsonString).toBeTypeOf("string");
    expect(blob.size).toBeGreaterThan(0);
  });

  it("restores a vault on a completely clean test browser from recovery secret", async () => {
    // 1. Export package
    const { jsonString } = await exportVaultBackup({
      vaultId: VAULT_ID,
      vek,
      keyEnvelopes,
      db,
    });

    // 2. Set up completely empty clean browser database
    const cleanDb = new MemoryDatabase();
    expect(await cleanDb.listRecordsByVault(VAULT_ID)).toHaveLength(0);
    expect(await cleanDb.listAttachmentsByVault(VAULT_ID)).toHaveLength(0);

    // 3. Stage the backup archive using recovery secret
    const plan = await stageVaultBackup({
      rawJsonOrPackage: jsonString,
      unlockSecret: { recoverySecret },
      db: cleanDb,
    });

    expect(plan.vaultId).toBe(VAULT_ID);
    expect(plan.summary.newCount).toBe(2);
    expect(plan.summary.conflictCount).toBe(0);
    expect(plan.items).toHaveLength(2);
    expect(plan.attachments).toHaveLength(1);

    // Records are decrypted and staged
    const titles = plan.items.map((i) => i.title);
    expect(titles).toContain("Google Workspace");
    expect(titles).toContain("Bank Account");

    // 4. Apply restore plan to clean database
    const result = await applyRestorePlan({
      plan,
      db: cleanDb,
    });

    expect(result.restoredCount).toBe(2);
    expect(result.skippedCount).toBe(0);

    const storedRecords = await cleanDb.listRecordsByVault(VAULT_ID);
    expect(storedRecords).toHaveLength(2);

    const storedAttachments = await cleanDb.listAttachmentsByVault(VAULT_ID);
    expect(storedAttachments).toHaveLength(1);

    const meta = await cleanDb.getVaultMetadata(VAULT_ID);
    expect(meta).not.toBeNull();
    expect(meta?.status).toBe("active");
  });

  it("restores a vault on a clean test browser using master password", async () => {
    const { jsonString } = await exportVaultBackup({
      vaultId: VAULT_ID,
      vek,
      keyEnvelopes,
      db,
    });

    const cleanDb = new MemoryDatabase();

    const plan = await stageVaultBackup({
      rawJsonOrPackage: jsonString,
      unlockSecret: { password: PASSWORD },
      db: cleanDb,
    });

    expect(plan.summary.newCount).toBe(2);
    const result = await applyRestorePlan({ plan, db: cleanDb });
    expect(result.restoredCount).toBe(2);
  });

  it("enforces conflict safeguards and does not silently overwrite newer data", async () => {
    // 1. Export package with record 1 at revision 2
    const { jsonString } = await exportVaultBackup({
      vaultId: VAULT_ID,
      vek,
      keyEnvelopes,
      db,
    });

    // 2. Local database moves forward to revision 5
    const existingRec1 = await db.getRecord(
      VAULT_ID,
      "aaaa0001-0000-4000-8000-000000000001",
    );
    expect(existingRec1).not.toBeNull();
    await db.putRecord({
      ...existingRec1!,
      revision: 5,
      updatedAt: new Date().toISOString(),
    });

    // 3. Stage the older backup archive
    const plan = await stageVaultBackup({
      rawJsonOrPackage: jsonString,
      unlockSecret: { vek },
      db,
    });

    // Item 1 (rev 2 vs local rev 5) is marked as conflict_older
    const item1 = plan.items.find(
      (i) => i.objectId === "aaaa0001-0000-4000-8000-000000000001",
    );
    expect(item1?.status).toBe("conflict_older");
    expect(item1?.backupRevision).toBe(2);
    expect(item1?.localRevision).toBe(5);

    // Item 2 (rev 1 vs local rev 1) is marked identical
    const item2 = plan.items.find(
      (i) => i.objectId === "aaaa0002-0000-4000-8000-000000000002",
    );
    expect(item2?.status).toBe("identical");

    expect(plan.summary.conflictCount).toBe(1);
    expect(plan.summary.identicalCount).toBe(1);

    // 4. Default restore without overwriteConflicts must skip conflict_older
    const restore1 = await applyRestorePlan({
      plan,
      overwriteConflicts: false,
      db,
    });
    expect(restore1.restoredCount).toBe(0);
    expect(restore1.skippedCount).toBe(2); // 1 identical + 1 older conflict

    // Verify local record is still revision 5! (NOT silently overwritten)
    const afterAttempt = await db.getRecord(
      VAULT_ID,
      "aaaa0001-0000-4000-8000-000000000001",
    );
    expect(afterAttempt?.revision).toBe(5);

    // 5. With explicit overwriteConflicts: true, it overwrites
    const restore2 = await applyRestorePlan({
      plan,
      overwriteConflicts: true,
      db,
    });
    expect(restore2.restoredCount).toBe(1);

    const afterForced = await db.getRecord(
      VAULT_ID,
      "aaaa0001-0000-4000-8000-000000000001",
    );
    expect(afterForced?.revision).toBe(2);
  });

  it("rejects invalid, corrupt, or tampered archives", async () => {
    // Malformed JSON
    await expect(
      stageVaultBackup({
        rawJsonOrPackage: "not-json-content",
        unlockSecret: { vek },
        db,
      }),
    ).rejects.toThrow(/not valid JSON/i);

    // Invalid schema
    await expect(
      stageVaultBackup({
        rawJsonOrPackage: JSON.stringify({ formatVersion: 99 }),
        unlockSecret: { vek },
        db,
      }),
    ).rejects.toThrow(/Invalid backup archive format/i);

    // Tampered archive package
    const { package: validPkg } = await exportVaultBackup({
      vaultId: VAULT_ID,
      vek,
      keyEnvelopes,
      db,
    });

    const tamperedPkg = {
      ...validPkg,
      ciphertext: validPkg.ciphertext.slice(0, -6) + "AAAAAA",
    };

    await expect(
      stageVaultBackup({
        rawJsonOrPackage: tamperedPkg,
        unlockSecret: { vek },
        db,
      }),
    ).rejects.toThrow(/digest mismatch|decryption failed/i);
  });
});
