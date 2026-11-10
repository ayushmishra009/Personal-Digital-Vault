import { z } from "zod";

const OpaqueIdSchema = z.uuid();
const Base64UrlSchema = z
  .string()
  .min(1)
  .regex(/^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2,3})?$/)
  .refine(
    isCanonicalBase64Url,
    "Base64url must use canonical unpadded encoding.",
  );
const DateTimeSchema = z.iso.datetime({ offset: true });
const KdfParametersSchema = z.record(
  z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/),
  z.number().int().nonnegative(),
);

function isCanonicalBase64Url(value: string): boolean {
  const remainder = value.length % 4;
  if (remainder === 0) return true;
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const finalSextet = alphabet.indexOf(value.at(-1) ?? "");
  if (remainder === 2) return (finalSextet & 0b1111) === 0;
  if (remainder === 3) return (finalSextet & 0b0011) === 0;
  return false;
}

export const VaultKeyEnvelopeSchema = z
  .strictObject({
    envelopeType: z.enum(["password", "recovery"]),
    protocolVersion: z.literal(1),
    keyWrapAlgorithm: z.literal("AES-256-KW"),
    kdfAlgorithm: z.enum(["argon2id13", "hkdf-sha256"]),
    kdfParameters: KdfParametersSchema,
    salt: Base64UrlSchema.length(22),
    wrappedVek: Base64UrlSchema.length(54),
  })
  .superRefine((envelope, ctx) => {
    if (envelope.envelopeType === "password") {
      const expectedBase = {
        version: 19,
        memoryKiB: 65_536,
        iterations: 3,
      };
      const supported = [
        { ...expectedBase, parallelism: 1 },
        { ...expectedBase, parallelism: 4 },
      ];
      if (envelope.kdfAlgorithm !== "argon2id13") {
        ctx.addIssue({
          code: "custom",
          path: ["kdfAlgorithm"],
          message: "Password envelopes require Argon2id v1.3.",
        });
      }
      if (
        !supported.some(
          (expected) =>
            JSON.stringify(Object.entries(envelope.kdfParameters).sort()) ===
            JSON.stringify(Object.entries(expected).sort()),
        )
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["kdfParameters"],
          message: "Unsupported Argon2id parameter tuple.",
        });
      }
    } else {
      if (envelope.kdfAlgorithm !== "hkdf-sha256") {
        ctx.addIssue({
          code: "custom",
          path: ["kdfAlgorithm"],
          message: "Recovery envelopes require HKDF-SHA-256.",
        });
      }
      if (Object.keys(envelope.kdfParameters).length !== 0) {
        ctx.addIssue({
          code: "custom",
          path: ["kdfParameters"],
          message: "Recovery envelopes do not have KDF parameters.",
        });
      }
    }
  });

/** Schema for envelopes newly created or written; p=1 remains read/unlock-only. */
export const NewVaultKeyEnvelopeSchema = VaultKeyEnvelopeSchema.superRefine(
  (envelope, ctx) => {
    if (
      envelope.envelopeType === "password" &&
      envelope.kdfParameters.parallelism !== 4
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["kdfParameters", "parallelism"],
        message: "New password envelopes require the proposed p=4 tuple.",
      });
    }
  },
);

export const EncryptedObjectEnvelopeSchema = z.strictObject({
  protocolVersion: z.literal(1),
  algorithm: z.literal("AES-256-GCM"),
  keyWrapAlgorithm: z.literal("AES-256-KW"),
  vaultId: OpaqueIdSchema,
  objectId: OpaqueIdSchema,
  revision: z.number().int().positive(),
  payloadVersion: z.number().int().positive(),
  purpose: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/),
  nonce: Base64UrlSchema.length(16),
  wrappedDek: Base64UrlSchema.length(54),
  ciphertext: Base64UrlSchema.min(22),
});

export const VaultMetadataSchema = z.strictObject({
  id: OpaqueIdSchema,
  protocolVersion: z.number().int().positive(),
  status: z.enum(["active", "deleted"]),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
});

export const AccountSchema = z.strictObject({
  id: OpaqueIdSchema,
  email: z.email(),
  status: z.enum(["active", "suspended"]),
  createdAt: DateTimeSchema,
});

export const DeviceSchema = z.strictObject({
  id: OpaqueIdSchema,
  label: z.string().min(1).max(100),
  platform: z.string().min(1).max(80),
  browser: z.string().min(1).max(80),
  status: z.enum(["pending", "active", "revoked"]),
  createdAt: DateTimeSchema,
  lastSeenAt: DateTimeSchema.optional(),
  revokedAt: DateTimeSchema.optional(),
});

export const AccountSessionSchema = z.strictObject({
  account: AccountSchema,
  device: DeviceSchema.optional(),
  authenticatedAt: DateTimeSchema,
  expiresAt: DateTimeSchema,
});

export const AccountRegistrationRequestSchema = z.strictObject({
  email: z.string().email(),
  deviceLabel: z.string().min(1).max(100),
  platform: z.string().min(1).max(80),
  browser: z.string().min(1).max(80),
  publicKeyAlgorithm: z.string().min(1).max(64),
  publicKey: Base64UrlSchema,
  credentialType: z.enum(["webauthn", "external"]),
  credentialId: z.string().min(1).max(255),
  credentialPublicKey: Base64UrlSchema.optional(),
  externalSubject: z.string().min(1).max(255).optional(),
});

export const AccountLoginRequestSchema = z.strictObject({
  email: z.string().email(),
  deviceId: OpaqueIdSchema,
  credentialType: z.enum(["webauthn", "external"]),
  credentialId: z.string().min(1).max(255),
  clientDataJson: Base64UrlSchema.optional(),
  authenticatorData: Base64UrlSchema.optional(),
  signature: Base64UrlSchema.optional(),
});

export const DeviceEnrollmentSchema = z.strictObject({
  id: OpaqueIdSchema,
  deviceId: OpaqueIdSchema,
  challenge: Base64UrlSchema,
  expiresAt: DateTimeSchema,
  status: z.enum(["pending", "approved", "rejected", "expired"]),
});

export const CreateVaultRequestSchema = z
  .strictObject({
    protocolVersion: z.literal(1),
    envelopes: z.tuple([NewVaultKeyEnvelopeSchema, NewVaultKeyEnvelopeSchema]),
  })
  .superRefine(({ protocolVersion, envelopes }, ctx) => {
    const [first, second] = envelopes;
    if (first.envelopeType === second.envelopeType) {
      ctx.addIssue({
        code: "custom",
        path: ["envelopes"],
        message:
          "One password envelope and one recovery envelope are required.",
      });
    }
    if (
      first.protocolVersion !== protocolVersion ||
      second.protocolVersion !== protocolVersion
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["envelopes"],
        message:
          "Envelope protocol versions must match the vault protocol version.",
      });
    }
  });

export const SyncOperationSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      operationId: OpaqueIdSchema,
      objectId: OpaqueIdSchema,
      kind: z.literal("upsert"),
      baseRevision: z.number().int().nonnegative(),
      envelope: EncryptedObjectEnvelopeSchema,
      clientCreatedAt: DateTimeSchema,
    }),
    z.strictObject({
      operationId: OpaqueIdSchema,
      objectId: OpaqueIdSchema,
      kind: z.literal("delete"),
      baseRevision: z.number().int().positive(),
      clientCreatedAt: DateTimeSchema,
    }),
  ])
  .superRefine((operation, ctx) => {
    if (operation.kind !== "upsert") return;
    if (operation.envelope.objectId !== operation.objectId) {
      ctx.addIssue({
        code: "custom",
        path: ["envelope", "objectId"],
        message: "Operation and encrypted envelope object IDs must match.",
      });
    }
    if (operation.envelope.revision !== operation.baseRevision + 1) {
      ctx.addIssue({
        code: "custom",
        path: ["envelope", "revision"],
        message:
          "Envelope revision must increment the supplied base revision by one.",
      });
    }
  });

export const DeviceEnrollmentRequestSchema = z.strictObject({
  deviceLabel: z.string().trim().min(1).max(100),
  platform: z.string().trim().min(1).max(80),
  browser: z.string().trim().min(1).max(80),
  publicKeyAlgorithm: z.string().min(1).max(64),
  publicKey: Base64UrlSchema,
});

const RecordBaseSchema = z.strictObject({
  id: OpaqueIdSchema,
  title: z.string(),
  tags: z.array(z.string()),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
});

const PrivateFieldsSchema = z.record(
  z.string(),
  z.union([z.string(), z.number(), z.boolean(), z.null()]),
);

export const DecryptedRecordSchema = z.discriminatedUnion("type", [
  RecordBaseSchema.extend({
    type: z.literal("password"),
    url: z.string().optional(),
    username: z.string().optional(),
    password: z.string(),
    notes: z.string().optional(),
  }),
  RecordBaseSchema.extend({
    type: z.literal("secure-note"),
    content: z.string(),
  }),
  RecordBaseSchema.extend({
    type: z.literal("identity"),
    fields: PrivateFieldsSchema,
  }),
  RecordBaseSchema.extend({
    type: z.literal("document"),
    attachmentIds: z.array(OpaqueIdSchema),
  }),
  RecordBaseSchema.extend({
    type: z.literal("payment"),
    fields: PrivateFieldsSchema,
  }),
]);

export const ProblemSchema = z.strictObject({
  error: z.strictObject({
    code: z.string(),
    message: z.string(),
    requestId: OpaqueIdSchema,
    details: z
      .strictObject({
        currentRevision: z.number().int().nonnegative().optional(),
        attemptedBaseRevision: z.number().int().nonnegative().optional(),
      })
      .optional(),
  }),
});

export type VaultKeyEnvelopeInput = z.input<typeof VaultKeyEnvelopeSchema>;
export type CreateVaultRequestInput = z.input<typeof CreateVaultRequestSchema>;
export type EncryptedObjectEnvelopeInput = z.input<
  typeof EncryptedObjectEnvelopeSchema
>;
export type AccountSessionInput = z.input<typeof AccountSessionSchema>;
export type DeviceEnrollmentInput = z.input<typeof DeviceEnrollmentSchema>;
export type SyncOperationInput = z.input<typeof SyncOperationSchema>;
export type DeviceEnrollmentRequestInput = z.input<
  typeof DeviceEnrollmentRequestSchema
>;
export type DecryptedRecordInput = z.input<typeof DecryptedRecordSchema>;
