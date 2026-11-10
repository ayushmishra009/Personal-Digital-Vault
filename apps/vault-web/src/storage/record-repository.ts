import {
  openObject,
  sealObject,
  type ObjectContext,
  type ObjectEnvelope,
} from "@pdv/crypto-core";
import type {
  DecryptedRecord,
  EncryptedObjectEnvelope,
  SyncOperation,
} from "@pdv/data-models";
import { DecryptedRecordSchema } from "@pdv/validation";
import {
  getLocalDatabase,
  type LocalDatabase,
  type StoredEncryptedRecord,
} from "./db";

export interface SaveRecordResult {
  envelope: EncryptedObjectEnvelope;
  record: DecryptedRecord;
}

export class EncryptedRecordRepository {
  constructor(private readonly db: LocalDatabase = getLocalDatabase()) {}

  /**
   * Save a decrypted record by generating an object envelope encrypted with the VEK.
   * Stored payloads are ciphertext only; plaintext records are never persisted.
   */
  async saveRecord(
    vaultId: string,
    vek: CryptoKey,
    record: DecryptedRecord,
    baseRevision = 0,
  ): Promise<SaveRecordResult> {
    // 1. Strict schema validation
    const validatedRecord = DecryptedRecordSchema.parse(
      record,
    ) as DecryptedRecord;
    const revision = baseRevision + 1;

    // 2. Cryptographic Object Context
    const context: ObjectContext = {
      protocolVersion: 1,
      purpose: "record",
      vaultId,
      objectId: validatedRecord.id,
      revision,
      payloadVersion: 1,
    };

    // 3. Encrypt payload with AES-256-GCM and wrap DEK with AES-256-KW
    const envelope = (await sealObject(
      vek,
      context,
      validatedRecord,
    )) as unknown as EncryptedObjectEnvelope;

    // 4. Store encrypted envelope in IndexedDB
    await this.db.putRecord({
      vaultId,
      objectId: validatedRecord.id,
      revision,
      payloadVersion: 1,
      envelope,
      updatedAt: validatedRecord.updatedAt,
    });

    // 5. Enqueue offline sync operation
    const op: SyncOperation = {
      operationId: crypto.randomUUID(),
      objectId: validatedRecord.id,
      kind: "upsert",
      baseRevision,
      envelope,
      clientCreatedAt: new Date().toISOString(),
    };
    await this.db.putPendingOperation(op);

    return { envelope, record: validatedRecord };
  }

  /**
   * Fetch and decrypt a single record from local IndexedDB.
   */
  async getRecord(
    vaultId: string,
    objectId: string,
    vek: CryptoKey,
  ): Promise<DecryptedRecord | null> {
    const stored = await this.db.getRecord(vaultId, objectId);
    if (!stored) return null;

    try {
      const decrypted = await openObject(
        vek,
        stored.envelope as unknown as ObjectEnvelope,
      );
      return DecryptedRecordSchema.parse(decrypted) as DecryptedRecord;
    } catch {
      throw new Error(`Failed to decrypt record ${objectId} with provided key`);
    }
  }

  /**
   * List and decrypt all records for a vault. Decryption happens locally in volatile memory.
   */
  async listRecords(
    vaultId: string,
    vek: CryptoKey,
  ): Promise<DecryptedRecord[]> {
    const storedRecords = await this.db.listRecordsByVault(vaultId);
    const records: DecryptedRecord[] = [];

    for (const stored of storedRecords) {
      try {
        const decrypted = await openObject(
          vek,
          stored.envelope as unknown as ObjectEnvelope,
        );
        records.push(DecryptedRecordSchema.parse(decrypted) as DecryptedRecord);
      } catch {
        // Skip or handle corrupted/cross-key envelope gracefully
      }
    }

    // Sort by updatedAt descending
    records.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    return records;
  }

  /**
   * Delete a record locally and queue a tombstone sync operation.
   */
  async deleteRecord(
    vaultId: string,
    objectId: string,
    baseRevision: number,
  ): Promise<void> {
    await this.db.deleteRecord(vaultId, objectId);

    const op: SyncOperation = {
      operationId: crypto.randomUUID(),
      objectId,
      kind: "delete",
      baseRevision,
      clientCreatedAt: new Date().toISOString(),
    };
    await this.db.putPendingOperation(op);
  }

  /**
   * Get all pending operations waiting to be synchronized.
   */
  async listPendingOperations(vaultId?: string): Promise<SyncOperation[]> {
    return this.db.listPendingOperations(vaultId);
  }

  /**
   * List raw encrypted records from database (for encrypted backup).
   */
  async listStoredRecords(vaultId: string): Promise<StoredEncryptedRecord[]> {
    return this.db.listRecordsByVault(vaultId);
  }

  /**
   * Put raw encrypted record into database (for encrypted restore).
   */
  async putRawStoredRecord(record: StoredEncryptedRecord): Promise<void> {
    return this.db.putRecord(record);
  }

  /**
   * Clear all local stores.
   */
  async clear(): Promise<void> {
    return this.db.clear();
  }
}

/**
 * Perform local search over decrypted records.
 * Searching happens strictly in client memory over decrypted values.
 */
export function searchDecryptedRecords(
  records: DecryptedRecord[],
  query: string,
): DecryptedRecord[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return records;

  return records.filter((r) => {
    // Title search
    if (r.title.toLowerCase().includes(normalizedQuery)) return true;

    // Tags search
    if (r.tags.some((t) => t.toLowerCase().includes(normalizedQuery)))
      return true;

    // Type-specific field search
    if (r.type === "password") {
      if (r.username && r.username.toLowerCase().includes(normalizedQuery))
        return true;
      if (r.url && r.url.toLowerCase().includes(normalizedQuery)) return true;
      if (r.notes && r.notes.toLowerCase().includes(normalizedQuery))
        return true;
    } else if (r.type === "secure-note") {
      if (r.content.toLowerCase().includes(normalizedQuery)) return true;
    } else if (r.type === "identity" || r.type === "payment") {
      for (const val of Object.values(r.fields)) {
        if (
          val !== null &&
          String(val).toLowerCase().includes(normalizedQuery)
        ) {
          return true;
        }
      }
    }
    return false;
  });
}
