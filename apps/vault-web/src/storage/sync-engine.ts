import type { DecryptedRecord } from "@pdv/data-models";
import {
  listSyncEvents,
  submitSyncOperation,
  getEncryptedObject,
  ConflictError,
  type SyncEvent,
} from "../api";
import {
  EncryptedRecordRepository,
  getRecordRepository,
} from "./record-repository";

export interface ActiveConflict {
  objectId: string;
  localRecord?: DecryptedRecord | null;
  remoteRecord?: DecryptedRecord | null;
  localRevision: number;
  remoteRevision: number;
  attemptedOperationId: string;
}

export type SyncStatus = "idle" | "syncing" | "offline" | "conflict";

export interface SyncResult {
  pulledEvents: number;
  pushedOperations: number;
  conflicts: ActiveConflict[];
}

export class SyncEngine {
  private repo: EncryptedRecordRepository;
  private status: SyncStatus = "idle";
  private activeConflicts: ActiveConflict[] = [];

  constructor(repo?: EncryptedRecordRepository) {
    this.repo = repo ?? getRecordRepository();
  }

  getStatus(): SyncStatus {
    return this.status;
  }

  getConflicts(): ActiveConflict[] {
    return this.activeConflicts;
  }

  clearConflict(objectId: string): void {
    this.activeConflicts = this.activeConflicts.filter(
      (c) => c.objectId !== objectId,
    );
    if (this.activeConflicts.length === 0 && this.status === "conflict") {
      this.status = "idle";
    }
  }

  /**
   * Synchronize active vault:
   * 1. Pull server events since local cursor and apply to IndexedDB.
   * 2. Push queued pending operations to server.
   * 3. On 409 Conflict, fetch remote ciphertext, decrypt both versions, and record active conflict.
   */
  async syncVault(vaultId: string, vek: CryptoKey): Promise<SyncResult> {
    this.status = "syncing";
    let pulledCount = 0;
    let pushedCount = 0;

    try {
      // Step 1: Pull remote changes
      const syncState = await this.repo.getSyncState(vaultId);
      let cursor = syncState?.lastSyncSequence ?? "0";
      let hasMore = true;

      while (hasMore) {
        const page = await listSyncEvents(vaultId, cursor, 50);
        for (const event of page.items) {
          await this.applyRemoteEvent(vaultId, event);
          pulledCount++;
        }
        cursor = page.nextCursor;
        hasMore = page.hasMore;
      }
      await this.repo.putSyncState(vaultId, cursor);

      // Step 2: Push pending operations
      const pendingOps = await this.repo.listPendingOperations(vaultId);
      for (const op of pendingOps) {
        try {
          await submitSyncOperation(vaultId, op);
          await this.repo.deletePendingOperation(op.operationId);
          pushedCount++;
        } catch (err: unknown) {
          if (err instanceof ConflictError) {
            // Conflict detected!
            const conflict = await this.resolveConflictDetails(
              vaultId,
              vek,
              op,
              err,
            );
            this.activeConflicts.push(conflict);
            this.status = "conflict";
            // Stop pushing further operations for this sync cycle
            break;
          } else {
            this.status = "offline";
            throw err;
          }
        }
      }

      if (this.activeConflicts.length === 0) {
        this.status = "idle";
      }

      return {
        pulledEvents: pulledCount,
        pushedOperations: pushedCount,
        conflicts: this.activeConflicts,
      };
    } catch (err) {
      if (this.activeConflicts.length > 0) {
        this.status = "conflict";
      } else {
        this.status = "offline";
      }
      throw err;
    }
  }

  private async applyRemoteEvent(
    vaultId: string,
    event: SyncEvent,
  ): Promise<void> {
    if (event.operationKind === "delete") {
      await this.repo.deleteRecord(vaultId, event.objectId, event.newRevision);
      return;
    }

    // Upsert event -> fetch latest ciphertext from server
    try {
      const envelope = await getEncryptedObject(
        vaultId,
        event.objectId,
        event.newRevision,
      );
      await this.repo.putRawStoredRecord({
        vaultId,
        objectId: event.objectId,
        revision: event.newRevision,
        payloadVersion: envelope.payloadVersion,
        envelope,
        updatedAt: event.createdAt,
      });
    } catch {
      // Continue if retrieval fails
    }
  }

  private async resolveConflictDetails(
    vaultId: string,
    vek: CryptoKey,
    op: { objectId: string; baseRevision: number; operationId: string },
    conflictErr: ConflictError,
  ): Promise<ActiveConflict> {
    const objectId = op.objectId;
    let localRecord: DecryptedRecord | null = null;
    let remoteRecord: DecryptedRecord | null = null;
    const remoteRev = conflictErr.currentRevision ?? op.baseRevision + 1;

    try {
      const localStored = await this.repo.getStoredRecord(vaultId, objectId);
      if (localStored) {
        localRecord = await this.repo.openRecord(localStored.envelope, vek);
      }
    } catch {
      // Leave null if error
    }

    try {
      const remoteEnvelope = await getEncryptedObject(
        vaultId,
        objectId,
        remoteRev,
      );
      remoteRecord = await this.repo.openRecord(remoteEnvelope, vek);
    } catch {
      // Leave null if error
    }

    return {
      objectId,
      localRecord,
      remoteRecord,
      localRevision: op.baseRevision,
      remoteRevision: remoteRev,
      attemptedOperationId: op.operationId,
    };
  }

  /**
   * User chooses to keep their local version:
   * Re-bases local record on remoteRevision, seals with VEK, removes old pending op, enqueues new.
   */
  async resolveKeepLocal(
    vaultId: string,
    vek: CryptoKey,
    conflict: ActiveConflict,
  ): Promise<void> {
    if (!conflict.localRecord) {
      throw new Error("No local record to keep");
    }
    await this.repo.deletePendingOperation(conflict.attemptedOperationId);
    await this.repo.saveRecord(
      vaultId,
      vek,
      conflict.localRecord,
      conflict.remoteRevision,
    );
    this.clearConflict(conflict.objectId);
  }

  /**
   * User chooses to accept the remote server version:
   * Discards local edit and accepts server version in store.
   */
  async resolveKeepRemote(
    _vaultId: string,
    conflict: ActiveConflict,
  ): Promise<void> {
    await this.repo.deletePendingOperation(conflict.attemptedOperationId);
    this.clearConflict(conflict.objectId);
  }

  /**
   * User manually merges the records:
   * Saves merged record with baseRevision = remoteRevision.
   */
  async resolveMerge(
    vaultId: string,
    vek: CryptoKey,
    conflict: ActiveConflict,
    mergedRecord: DecryptedRecord,
  ): Promise<void> {
    await this.repo.deletePendingOperation(conflict.attemptedOperationId);
    await this.repo.saveRecord(
      vaultId,
      vek,
      mergedRecord,
      conflict.remoteRevision,
    );
    this.clearConflict(conflict.objectId);
  }
}

let syncEngineInstance: SyncEngine | null = null;
export function getSyncEngine(): SyncEngine {
  if (!syncEngineInstance) {
    syncEngineInstance = new SyncEngine();
  }
  return syncEngineInstance;
}
