import type {
  EncryptedObjectEnvelope,
  SyncOperation,
  VaultMetadata,
} from "@pdv/data-models";

export const DB_NAME = "pdv_local_store";
export const DB_VERSION = 2;

export interface StoredEncryptedRecord {
  vaultId: string;
  objectId: string;
  revision: number;
  payloadVersion: number;
  envelope: EncryptedObjectEnvelope;
  updatedAt: string;
}

export interface StoredEncryptedAttachment {
  vaultId: string;
  attachmentId: string;
  ciphertext: Uint8Array;
  ciphertextSize: number;
  ciphertextDigest: string;
  updatedAt: string;
}

export interface LocalSyncState {
  vaultId: string;
  lastSyncSequence?: string;
  lastSyncedAt?: string;
}

export interface LocalDatabase {
  putRecord(record: StoredEncryptedRecord): Promise<void>;
  getRecord(
    vaultId: string,
    objectId: string,
  ): Promise<StoredEncryptedRecord | null>;
  listRecordsByVault(vaultId: string): Promise<StoredEncryptedRecord[]>;
  deleteRecord(vaultId: string, objectId: string): Promise<void>;

  putPendingOperation(op: SyncOperation): Promise<void>;
  listPendingOperations(vaultId?: string): Promise<SyncOperation[]>;
  deletePendingOperation(operationId: string): Promise<void>;

  putVaultMetadata(meta: VaultMetadata): Promise<void>;
  getVaultMetadata(vaultId: string): Promise<VaultMetadata | null>;
  listVaultMetadata(): Promise<VaultMetadata[]>;
  deleteVaultMetadata(vaultId: string): Promise<void>;

  putSyncState(state: LocalSyncState): Promise<void>;
  getSyncState(vaultId: string): Promise<LocalSyncState | null>;

  putAttachment(att: StoredEncryptedAttachment): Promise<void>;
  getAttachment(
    vaultId: string,
    attachmentId: string,
  ): Promise<StoredEncryptedAttachment | null>;
  deleteAttachment(vaultId: string, attachmentId: string): Promise<void>;

  clear(): Promise<void>;
}

class IndexedDBDatabase implements LocalDatabase {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private async getDB(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;

          // encrypted_records store
          if (!db.objectStoreNames.contains("encrypted_records")) {
            const store = db.createObjectStore("encrypted_records", {
              keyPath: ["vaultId", "objectId"],
            });
            store.createIndex("vaultId", "vaultId", { unique: false });
            store.createIndex("objectId", "objectId", { unique: false });
            store.createIndex("revision", "revision", { unique: false });
            store.createIndex("updatedAt", "updatedAt", { unique: false });
          }

          // pending_operations store
          if (!db.objectStoreNames.contains("pending_operations")) {
            const store = db.createObjectStore("pending_operations", {
              keyPath: "operationId",
            });
            store.createIndex("objectId", "objectId", { unique: false });
            store.createIndex("clientCreatedAt", "clientCreatedAt", {
              unique: false,
            });
          }

          // vault_metadata store
          if (!db.objectStoreNames.contains("vault_metadata")) {
            db.createObjectStore("vault_metadata", { keyPath: "id" });
          }

          // sync_state store
          if (!db.objectStoreNames.contains("sync_state")) {
            db.createObjectStore("sync_state", { keyPath: "vaultId" });
          }

          // encrypted_attachments store
          if (!db.objectStoreNames.contains("encrypted_attachments")) {
            const store = db.createObjectStore("encrypted_attachments", {
              keyPath: ["vaultId", "attachmentId"],
            });
            store.createIndex("vaultId", "vaultId", { unique: false });
            store.createIndex("attachmentId", "attachmentId", {
              unique: false,
            });
          }
        };

        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.dbPromise;
  }

  async putRecord(record: StoredEncryptedRecord): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("encrypted_records", "readwrite");
      tx.objectStore("encrypted_records").put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getRecord(
    vaultId: string,
    objectId: string,
  ): Promise<StoredEncryptedRecord | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("encrypted_records", "readonly");
      const req = tx.objectStore("encrypted_records").get([vaultId, objectId]);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async listRecordsByVault(vaultId: string): Promise<StoredEncryptedRecord[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("encrypted_records", "readonly");
      const index = tx.objectStore("encrypted_records").index("vaultId");
      const req = index.getAll(vaultId);
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error);
    });
  }

  async deleteRecord(vaultId: string, objectId: string): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("encrypted_records", "readwrite");
      tx.objectStore("encrypted_records").delete([vaultId, objectId]);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async putPendingOperation(op: SyncOperation): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("pending_operations", "readwrite");
      tx.objectStore("pending_operations").put(op);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async listPendingOperations(vaultId?: string): Promise<SyncOperation[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("pending_operations", "readonly");
      const req = tx.objectStore("pending_operations").getAll();
      req.onsuccess = () => {
        let items: SyncOperation[] = req.result ?? [];
        if (vaultId) {
          items = items.filter((op) => {
            if (op.kind === "upsert") return op.envelope.vaultId === vaultId;
            return true;
          });
        }
        resolve(items);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async deletePendingOperation(operationId: string): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("pending_operations", "readwrite");
      tx.objectStore("pending_operations").delete(operationId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async putVaultMetadata(meta: VaultMetadata): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("vault_metadata", "readwrite");
      tx.objectStore("vault_metadata").put(meta);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getVaultMetadata(vaultId: string): Promise<VaultMetadata | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("vault_metadata", "readonly");
      const req = tx.objectStore("vault_metadata").get(vaultId);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async listVaultMetadata(): Promise<VaultMetadata[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("vault_metadata", "readonly");
      const req = tx.objectStore("vault_metadata").getAll();
      req.onsuccess = () => resolve(req.result ?? []);
      req.onerror = () => reject(req.error);
    });
  }

  async deleteVaultMetadata(vaultId: string): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("vault_metadata", "readwrite");
      tx.objectStore("vault_metadata").delete(vaultId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async putSyncState(state: LocalSyncState): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("sync_state", "readwrite");
      tx.objectStore("sync_state").put(state);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getSyncState(vaultId: string): Promise<LocalSyncState | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("sync_state", "readonly");
      const req = tx.objectStore("sync_state").get(vaultId);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async putAttachment(att: StoredEncryptedAttachment): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("encrypted_attachments", "readwrite");
      tx.objectStore("encrypted_attachments").put(att);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getAttachment(
    vaultId: string,
    attachmentId: string,
  ): Promise<StoredEncryptedAttachment | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("encrypted_attachments", "readonly");
      const req = tx
        .objectStore("encrypted_attachments")
        .get([vaultId, attachmentId]);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async deleteAttachment(vaultId: string, attachmentId: string): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("encrypted_attachments", "readwrite");
      tx.objectStore("encrypted_attachments").delete([vaultId, attachmentId]);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async clear(): Promise<void> {
    const db = await this.getDB();
    const storeNames = Array.from(db.objectStoreNames);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeNames, "readwrite");
      for (const name of storeNames) {
        tx.objectStore(name).clear();
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

/** In-memory implementation used for headless / node testing environments */
export class MemoryDatabase implements LocalDatabase {
  private records = new Map<string, StoredEncryptedRecord>();
  private pendingOps = new Map<string, SyncOperation>();
  private vaults = new Map<string, VaultMetadata>();
  private syncStates = new Map<string, LocalSyncState>();
  private attachments = new Map<string, StoredEncryptedAttachment>();

  private recordKey(vaultId: string, objectId: string): string {
    return `${vaultId}:${objectId}`;
  }

  private attachmentKey(vaultId: string, attachmentId: string): string {
    return `${vaultId}:${attachmentId}`;
  }

  async putRecord(record: StoredEncryptedRecord): Promise<void> {
    this.records.set(this.recordKey(record.vaultId, record.objectId), record);
  }

  async getRecord(
    vaultId: string,
    objectId: string,
  ): Promise<StoredEncryptedRecord | null> {
    return this.records.get(this.recordKey(vaultId, objectId)) ?? null;
  }

  async listRecordsByVault(vaultId: string): Promise<StoredEncryptedRecord[]> {
    const results: StoredEncryptedRecord[] = [];
    for (const rec of this.records.values()) {
      if (rec.vaultId === vaultId) results.push(rec);
    }
    return results;
  }

  async deleteRecord(vaultId: string, objectId: string): Promise<void> {
    this.records.delete(this.recordKey(vaultId, objectId));
  }

  async putPendingOperation(op: SyncOperation): Promise<void> {
    this.pendingOps.set(op.operationId, op);
  }

  async listPendingOperations(vaultId?: string): Promise<SyncOperation[]> {
    let ops = Array.from(this.pendingOps.values());
    if (vaultId) {
      ops = ops.filter((op) => {
        if (op.kind === "upsert") return op.envelope.vaultId === vaultId;
        return true;
      });
    }
    return ops;
  }

  async deletePendingOperation(operationId: string): Promise<void> {
    this.pendingOps.delete(operationId);
  }

  async putVaultMetadata(meta: VaultMetadata): Promise<void> {
    this.vaults.set(meta.id, meta);
  }

  async getVaultMetadata(vaultId: string): Promise<VaultMetadata | null> {
    return this.vaults.get(vaultId) ?? null;
  }

  async listVaultMetadata(): Promise<VaultMetadata[]> {
    return Array.from(this.vaults.values());
  }

  async deleteVaultMetadata(vaultId: string): Promise<void> {
    this.vaults.delete(vaultId);
  }

  async putSyncState(state: LocalSyncState): Promise<void> {
    this.syncStates.set(state.vaultId, state);
  }

  async getSyncState(vaultId: string): Promise<LocalSyncState | null> {
    return this.syncStates.get(vaultId) ?? null;
  }

  async putAttachment(att: StoredEncryptedAttachment): Promise<void> {
    this.attachments.set(
      this.attachmentKey(att.vaultId, att.attachmentId),
      att,
    );
  }

  async getAttachment(
    vaultId: string,
    attachmentId: string,
  ): Promise<StoredEncryptedAttachment | null> {
    return (
      this.attachments.get(this.attachmentKey(vaultId, attachmentId)) ?? null
    );
  }

  async deleteAttachment(vaultId: string, attachmentId: string): Promise<void> {
    this.attachments.delete(this.attachmentKey(vaultId, attachmentId));
  }

  async clear(): Promise<void> {
    this.records.clear();
    this.pendingOps.clear();
    this.vaults.clear();
    this.syncStates.clear();
    this.attachments.clear();
  }
}

let dbInstance: LocalDatabase | null = null;

export function getLocalDatabase(): LocalDatabase {
  if (!dbInstance) {
    if (typeof indexedDB !== "undefined") {
      dbInstance = new IndexedDBDatabase();
    } else {
      dbInstance = new MemoryDatabase();
    }
  }
  return dbInstance;
}

export function setLocalDatabaseForTesting(
  customDb: LocalDatabase | null,
): void {
  dbInstance = customDb;
}
