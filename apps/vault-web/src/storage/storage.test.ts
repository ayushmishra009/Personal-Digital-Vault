import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { importVek } from "@pdv/crypto-core";
import { MemoryDatabase, setLocalDatabaseForTesting } from "./db";
import {
  EncryptedRecordRepository,
  searchDecryptedRecords,
} from "./record-repository";
import {
  generatePassword,
  estimatePasswordStrength,
} from "./password-generator";
import { setupInactivityTracker } from "./inactivity";
import type {
  PasswordRecord,
  SecureNoteRecord,
  IdentityRecord,
  PaymentRecord,
} from "@pdv/data-models";

describe("Phase 5: Local Encrypted Record Engine", () => {
  let db: MemoryDatabase;
  let repo: EncryptedRecordRepository;
  let vek: CryptoKey;
  let wrongVek: CryptoKey;

  beforeEach(async () => {
    db = new MemoryDatabase();
    setLocalDatabaseForTesting(db);
    repo = new EncryptedRecordRepository(db);

    // Generate real non-extractable HKDF VEK handles for testing
    const raw1 = crypto.getRandomValues(new Uint8Array(32));
    const raw2 = crypto.getRandomValues(new Uint8Array(32));
    vek = await importVek(raw1);
    wrongVek = await importVek(raw2);
  });

  afterEach(() => {
    setLocalDatabaseForTesting(null);
  });

  it("saves, retrieves, and verifies ciphertext at rest for all record types", async () => {
    const vaultId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

    // 1. Password Record
    const pwRecord: PasswordRecord = {
      id: "a1111111-1111-4111-8111-111111111111",
      type: "password",
      title: "GitHub Personal Account",
      tags: ["dev", "work"],
      url: "https://github.com",
      username: "developer@example.com",
      password: "SuperSecretPassword123!",
      notes: "SSH key backed up on YubiKey",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const { envelope } = await repo.saveRecord(vaultId, vek, pwRecord);
    expect(envelope.vaultId).toBe(vaultId);
    expect(envelope.objectId).toBe(pwRecord.id);
    expect(envelope.algorithm).toBe("AES-256-GCM");
    expect(envelope.keyWrapAlgorithm).toBe("AES-256-KW");
    expect(envelope.revision).toBe(1);

    // Verify storage contains ONLY ciphertext
    const stored = await db.getRecord(vaultId, pwRecord.id);
    expect(stored).not.toBeNull();
    const storedJson = JSON.stringify(stored);
    expect(storedJson).not.toContain("GitHub Personal Account");
    expect(storedJson).not.toContain("SuperSecretPassword123!");
    expect(storedJson).not.toContain("developer@example.com");

    // Decrypt and verify matching plaintext
    const retrieved = (await repo.getRecord(
      vaultId,
      pwRecord.id,
      vek,
    )) as PasswordRecord;
    expect(retrieved).not.toBeNull();
    expect(retrieved.title).toBe(pwRecord.title);
    expect(retrieved.password).toBe("SuperSecretPassword123!");
    expect(retrieved.username).toBe("developer@example.com");

    // Decrypt with wrong key fails closed
    await expect(
      repo.getRecord(vaultId, pwRecord.id, wrongVek),
    ).rejects.toThrow();

    // 2. Secure Note Record
    const noteRecord: SecureNoteRecord = {
      id: "b2222222-2222-4222-8222-222222222222",
      type: "secure-note",
      title: "Server Deployment Checklist",
      tags: ["ops"],
      content: "1. Update .env\n2. Run migrations\n3. Restart daemon",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await repo.saveRecord(vaultId, vek, noteRecord);
    const retrievedNote = (await repo.getRecord(
      vaultId,
      noteRecord.id,
      vek,
    )) as SecureNoteRecord;
    expect(retrievedNote.content).toBe(noteRecord.content);

    // 3. Identity Record
    const idRecord: IdentityRecord = {
      id: "c3333333-3333-4333-8333-333333333333",
      type: "identity",
      title: "Passport Information",
      tags: ["travel"],
      fields: {
        passportNumber: "Z12345678",
        issuingCountry: "USA",
        expiryYear: 2030,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await repo.saveRecord(vaultId, vek, idRecord);
    const retrievedId = (await repo.getRecord(
      vaultId,
      idRecord.id,
      vek,
    )) as IdentityRecord;
    expect(retrievedId.fields.passportNumber).toBe("Z12345678");

    // 4. Payment Record
    const payRecord: PaymentRecord = {
      id: "d4444444-4444-4444-8444-444444444444",
      type: "payment",
      title: "Primary Credit Card",
      tags: ["finance"],
      fields: {
        cardNumber: "4000123456789010",
        cardholder: "Jane Doe",
        expiry: "12/28",
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await repo.saveRecord(vaultId, vek, payRecord);
    const retrievedPay = (await repo.getRecord(
      vaultId,
      payRecord.id,
      vek,
    )) as PaymentRecord;
    expect(retrievedPay.fields.cardNumber).toBe("4000123456789010");

    // 5. List all records for vault
    const allRecords = await repo.listRecords(vaultId, vek);
    expect(allRecords.length).toBe(4);

    // 6. Delete record and verify tombstone operation
    await repo.deleteRecord(vaultId, payRecord.id, 1);
    const afterDelete = await repo.getRecord(vaultId, payRecord.id, vek);
    expect(afterDelete).toBeNull();

    const pendingOps = await repo.listPendingOperations(vaultId);
    expect(pendingOps.length).toBe(5); // 4 upserts + 1 delete
    const deleteOp = pendingOps.find(
      (op) => op.kind === "delete" && op.objectId === payRecord.id,
    );
    expect(deleteOp).toBeDefined();
    expect(deleteOp?.baseRevision).toBe(1);
  });

  it("performs local search across decrypted fields", async () => {
    const pw1: PasswordRecord = {
      id: "a1111111-1111-4111-8111-111111111111",
      type: "password",
      title: "AWS Console",
      tags: ["cloud", "infra"],
      username: "admin@mycorp.com",
      password: "p1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const pw2: PasswordRecord = {
      id: "a2222222-2222-4222-8222-222222222222",
      type: "password",
      title: "Google Workspace",
      tags: ["email", "productivity"],
      username: "user@gmail.com",
      password: "p2",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const note: SecureNoteRecord = {
      id: "b3333333-3333-4333-8333-333333333333",
      type: "secure-note",
      title: "Meeting Notes",
      tags: ["work"],
      content: "Discussing AWS migration budget",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const records = [pw1, pw2, note];

    // Search by title
    expect(searchDecryptedRecords(records, "google").length).toBe(1);
    expect(searchDecryptedRecords(records, "google")[0].id).toBe(pw2.id);

    // Search by tag
    expect(searchDecryptedRecords(records, "infra").length).toBe(1);
    expect(searchDecryptedRecords(records, "infra")[0].id).toBe(pw1.id);

    // Search across content and title
    const awsMatches = searchDecryptedRecords(records, "AWS");
    expect(awsMatches.length).toBe(2); // pw1 title and note content
  });

  it("generates cryptographically secure passwords and evaluates strength", () => {
    // Default 20-char password
    const p1 = generatePassword();
    expect(p1.length).toBe(20);
    expect(/[A-Z]/.test(p1)).toBe(true);
    expect(/[a-z]/.test(p1)).toBe(true);
    expect(/[0-9]/.test(p1)).toBe(true);
    expect(/[^a-zA-Z0-9]/.test(p1)).toBe(true);

    // Custom length without ambiguous characters
    const p2 = generatePassword({
      length: 32,
      excludeAmbiguous: true,
    });
    expect(p2.length).toBe(32);
    expect(/[0Ol1I]/.test(p2)).toBe(false);

    // Strength estimation
    const weak = estimatePasswordStrength("simple");
    expect(weak.label).toBe("Weak");

    const strong = estimatePasswordStrength("K9#mQ$8vL2!zW7@pX4&d");
    expect(strong.label).toBe("Very Strong");
    expect(strong.entropyBits).toBeGreaterThan(100);
  });

  it("handles inactivity timeout callback", () => {
    vi.useFakeTimers();
    let locked = false;

    const tracker = setupInactivityTracker(15_000, () => {
      locked = true;
    });

    vi.advanceTimersByTime(10_000);
    expect(locked).toBe(false);

    // Reset before timeout
    tracker.reset();
    vi.advanceTimersByTime(10_000);
    expect(locked).toBe(false);

    // Allow full duration
    vi.advanceTimersByTime(6_000);
    expect(locked).toBe(true);

    tracker.dispose();
    vi.useRealTimers();
  });
});
