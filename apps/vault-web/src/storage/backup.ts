import type {
  EncryptedBackupPackage,
  StagedRestorePlan,
  StagedRestoreItem,
  RestoreRecordStatus,
  DecryptedRecord,
  VaultKeyEnvelope,
  EncryptedObjectEnvelope,
  BackupRecordItem,
  BackupAttachmentItem,
} from "@pdv/data-models";
import { EncryptedBackupPackageSchema } from "@pdv/validation";
import {
  sealBackupPackage,
  openBackupPackage,
  openObject,
  computeDigest,
  decodeBase64Url,
  decodeRecoverySecret,
  unwrapVekWithPassword,
  unwrapVekWithRecovery,
  type VekEnvelope,
  type ObjectEnvelope,
  type Argon2idProvider,
} from "@pdv/crypto-core";
import {
  getLocalDatabase,
  type LocalDatabase,
  type StoredEncryptedRecord,
  type StoredEncryptedAttachment,
} from "./db";
import { getArgon2Module, DirectArgon2idProvider } from "../crypto";

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.length;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export interface ExportBackupOptions {
  vaultId: string;
  vek: CryptoKey;
  keyEnvelopes: VaultKeyEnvelope[];
  db?: LocalDatabase;
}

export async function exportVaultBackup(options: ExportBackupOptions): Promise<{
  package: EncryptedBackupPackage;
  jsonString: string;
  blob: Blob;
}> {
  const { vaultId, vek, keyEnvelopes, db = getLocalDatabase() } = options;

  const records: StoredEncryptedRecord[] = await db.listRecordsByVault(vaultId);
  const attachments: StoredEncryptedAttachment[] =
    await db.listAttachmentsByVault(vaultId);
  const syncState = await db.getSyncState(vaultId);

  const snapshotId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  const backupRecords: BackupRecordItem[] = [];
  for (const r of records) {
    const ciphertextBytes = decodeBase64Url(r.envelope.ciphertext);
    const ciphertextHash = await computeDigest(ciphertextBytes);
    backupRecords.push({
      objectId: r.objectId,
      revision: r.revision,
      payloadVersion: r.payloadVersion,
      envelope: r.envelope,
      ciphertextHash,
      updatedAt: r.updatedAt,
    });
  }

  const backupAttachments: BackupAttachmentItem[] = [];
  for (const a of attachments) {
    backupAttachments.push({
      attachmentId: a.attachmentId,
      ciphertextSize: a.ciphertextSize,
      ciphertextDigest: a.ciphertextDigest,
      ciphertextBase64: uint8ArrayToBase64(a.ciphertext),
      updatedAt: a.updatedAt,
    });
  }

  const sealed = await sealBackupPackage(vek, {
    vaultId,
    snapshotId,
    createdAt,
    keyEnvelopes: keyEnvelopes as unknown as VekEnvelope[],
    syncCursor: syncState?.lastSyncSequence,
    records: backupRecords as unknown as Array<{
      objectId: string;
      revision: number;
      payloadVersion: number;
      envelope: ObjectEnvelope;
      ciphertextHash: string;
      updatedAt: string;
    }>,
    attachments: backupAttachments,
  });

  const jsonString = JSON.stringify(sealed, null, 2);
  const blob = new Blob([jsonString], { type: "application/json" });

  return {
    package: sealed as unknown as EncryptedBackupPackage,
    jsonString,
    blob,
  };
}

export async function recordBackupMetadataToServer(
  vaultId: string,
  pkg: EncryptedBackupPackage,
): Promise<boolean> {
  try {
    const res = await fetch(`/api/v1/vaults/${vaultId}/backup/metadata`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        snapshotId: pkg.snapshotId,
        ciphertextSize: pkg.ciphertextSize,
        ciphertextDigest: pkg.ciphertextDigest,
      }),
    });
    return res.ok;
  } catch {
    // Server backup logging is non-blocking to allow full offline backups
    return false;
  }
}

export interface StageBackupOptions {
  rawJsonOrPackage: string | EncryptedBackupPackage;
  unlockSecret: {
    password?: string;
    recoverySecret?: string;
    vek?: CryptoKey;
  };
  db?: LocalDatabase;
  argon2Provider?: Argon2idProvider;
}

export async function stageVaultBackup(
  options: StageBackupOptions,
): Promise<StagedRestorePlan> {
  const {
    rawJsonOrPackage,
    unlockSecret,
    db = getLocalDatabase(),
    argon2Provider,
  } = options;

  let pkg: EncryptedBackupPackage;
  if (typeof rawJsonOrPackage === "string") {
    try {
      pkg = JSON.parse(rawJsonOrPackage);
    } catch {
      throw new Error("Invalid backup file: not valid JSON format");
    }
  } else {
    pkg = rawJsonOrPackage;
  }

  const validation = EncryptedBackupPackageSchema.safeParse(pkg);
  if (!validation.success) {
    throw new Error(
      `Invalid backup archive format: ${validation.error.issues.map((i) => i.message).join(", ")}`,
    );
  }

  let vek: CryptoKey;
  if (unlockSecret.vek) {
    vek = unlockSecret.vek;
  } else if (unlockSecret.password) {
    const pEnv = pkg.keyEnvelopes.find((e) => e.envelopeType === "password");
    if (!pEnv) {
      throw new Error(
        "Backup archive does not contain a password key envelope",
      );
    }
    let provider = argon2Provider;
    if (!provider) {
      const module = await getArgon2Module();
      provider = new DirectArgon2idProvider(module);
    }
    vek = await unwrapVekWithPassword(
      unlockSecret.password,
      pEnv as unknown as VekEnvelope,
      provider,
    );
  } else if (unlockSecret.recoverySecret) {
    const rEnv = pkg.keyEnvelopes.find((e) => e.envelopeType === "recovery");
    if (!rEnv) {
      throw new Error(
        "Backup archive does not contain a recovery key envelope",
      );
    }
    const secretBytes = decodeRecoverySecret(unlockSecret.recoverySecret);
    vek = await unwrapVekWithRecovery(
      secretBytes,
      rEnv as unknown as VekEnvelope,
    );
  } else {
    throw new Error(
      "Unlock credentials required: master password, recovery secret, or unlocked VEK",
    );
  }

  // openBackupPackage verifies format, size, ciphertext hash, decrypts,
  // and re-verifies internal record digests and aggregated rootHash
  const opened = await openBackupPackage(
    pkg as unknown as Parameters<typeof openBackupPackage>[0],
    vek,
  );

  const items: StagedRestoreItem[] = [];
  let newCount = 0;
  let upgradedCount = 0;
  let identicalCount = 0;
  let conflictCount = 0;

  for (const record of opened.records) {
    let decryptedRecord: DecryptedRecord;
    try {
      decryptedRecord = (await openObject(
        vek,
        record.envelope as unknown as ObjectEnvelope,
      )) as DecryptedRecord;
    } catch {
      throw new Error(
        `Failed to decrypt staged record ${record.objectId}: invalid DEK or corrupted envelope`,
      );
    }

    const localRecord = await db.getRecord(opened.vaultId, record.objectId);

    let status: RestoreRecordStatus;
    let localRevision: number | undefined;

    if (!localRecord) {
      status = "new";
      newCount++;
    } else {
      localRevision = localRecord.revision;
      if (record.revision > localRecord.revision) {
        status = "upgraded";
        upgradedCount++;
      } else if (
        record.revision === localRecord.revision &&
        record.envelope.ciphertext === localRecord.envelope.ciphertext
      ) {
        status = "identical";
        identicalCount++;
      } else if (record.revision < localRecord.revision) {
        status = "conflict_older";
        conflictCount++;
      } else {
        status = "conflict_divergent";
        conflictCount++;
      }
    }

    items.push({
      objectId: record.objectId,
      title: decryptedRecord.title || "Untitled Record",
      type: decryptedRecord.type || "unknown",
      status,
      backupRevision: record.revision,
      localRevision,
      record: decryptedRecord,
      envelope: record.envelope as unknown as EncryptedObjectEnvelope,
    });
  }

  return {
    vaultId: opened.vaultId,
    snapshotId: opened.snapshotId,
    createdAt: opened.createdAt,
    items,
    attachments: opened.attachments as unknown as BackupAttachmentItem[],
    summary: {
      newCount,
      upgradedCount,
      identicalCount,
      conflictCount,
    },
  };
}

export interface ApplyRestoreOptions {
  plan: StagedRestorePlan;
  overwriteConflicts?: boolean;
  selectedObjectIds?: string[];
  db?: LocalDatabase;
}

export async function applyRestorePlan(options: ApplyRestoreOptions): Promise<{
  restoredCount: number;
  skippedCount: number;
}> {
  const {
    plan,
    overwriteConflicts = false,
    selectedObjectIds,
    db = getLocalDatabase(),
  } = options;

  let restoredCount = 0;
  let skippedCount = 0;

  for (const item of plan.items) {
    if (selectedObjectIds && !selectedObjectIds.includes(item.objectId)) {
      skippedCount++;
      continue;
    }

    if (item.status === "identical") {
      skippedCount++;
      continue;
    }

    if (
      (item.status === "conflict_older" ||
        item.status === "conflict_divergent") &&
      !overwriteConflicts
    ) {
      skippedCount++;
      continue;
    }

    await db.putRecord({
      vaultId: plan.vaultId,
      objectId: item.objectId,
      revision: item.backupRevision,
      payloadVersion: item.envelope.payloadVersion,
      envelope: item.envelope,
      updatedAt: new Date().toISOString(),
    });
    restoredCount++;
  }

  for (const att of plan.attachments) {
    if (att.ciphertextBase64) {
      const ciphertext = base64ToUint8Array(att.ciphertextBase64);
      await db.putAttachment({
        vaultId: plan.vaultId,
        attachmentId: att.attachmentId,
        ciphertext,
        ciphertextSize: att.ciphertextSize,
        ciphertextDigest: att.ciphertextDigest,
        updatedAt: att.updatedAt,
      });
    }
  }

  // Ensure vault metadata exists
  const existingMeta = await db.getVaultMetadata(plan.vaultId);
  if (!existingMeta) {
    await db.putVaultMetadata({
      id: plan.vaultId,
      protocolVersion: 1,
      status: "active",
      createdAt: plan.createdAt,
      updatedAt: new Date().toISOString(),
    });
  }

  return {
    restoredCount,
    skippedCount,
  };
}
