import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createVaultKeyEnvelopes,
  unlockWithPassword,
  unlockWithRecovery,
  changePassword,
} from "./crypto";

describe("Vault Lifecycle & Cryptographic Key Envelopes", () => {
  beforeAll(() => {
    // Mock fetch for WASM binary in node test environment
    const wasmPath = resolve(
      __dirname,
      "../public/pdv_argon2_wasm_candidate.wasm",
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

  it("creates valid p=4 password and recovery envelopes", async () => {
    const password = "my-secret-vault-password-2026!";
    const { vek, recoverySecret, passwordEnvelope, recoveryEnvelope } =
      await createVaultKeyEnvelopes(password);

    expect(vek).toBeDefined();
    expect(recoverySecret).toBeTypeOf("string");
    expect(recoverySecret.length).toBeGreaterThan(30);

    // Verify password envelope structure
    expect(passwordEnvelope.protocolVersion).toBe(1);
    expect(passwordEnvelope.envelopeType).toBe("password");
    expect(passwordEnvelope.keyWrapAlgorithm).toBe("AES-256-KW");
    expect(passwordEnvelope.kdfAlgorithm).toBe("argon2id13");
    expect(passwordEnvelope.kdfParameters.parallelism).toBe(4);
    expect(passwordEnvelope.kdfParameters.memoryKiB).toBe(65536);
    expect(passwordEnvelope.kdfParameters.iterations).toBe(3);

    // Verify recovery envelope structure
    expect(recoveryEnvelope.protocolVersion).toBe(1);
    expect(recoveryEnvelope.envelopeType).toBe("recovery");
    expect(recoveryEnvelope.keyWrapAlgorithm).toBe("AES-256-KW");
    expect(recoveryEnvelope.kdfAlgorithm).toBe("hkdf-sha256");

    // Unlock with correct password
    const unwrappedVek = await unlockWithPassword(password, passwordEnvelope);
    expect(unwrappedVek).toBeDefined();

    // Unlock with recovery secret
    const unwrappedVekFromRecovery = await unlockWithRecovery(
      recoverySecret,
      recoveryEnvelope,
    );
    expect(unwrappedVekFromRecovery).toBeDefined();

    // Wrong password should reject
    await expect(
      unlockWithPassword("wrong-password", passwordEnvelope),
    ).rejects.toThrow();

    // Password change (rewrap VEK)
    const newPassword = "new-even-stronger-password-2026!";
    const { vek: newVek, passwordEnvelope: newEnvelope } = await changePassword(
      password,
      passwordEnvelope,
      newPassword,
    );
    expect(newVek).toBeDefined();
    expect(newEnvelope.salt).not.toBe(passwordEnvelope.salt);

    // New password unlocks new envelope
    const unwrappedWithNew = await unlockWithPassword(newPassword, newEnvelope);
    expect(unwrappedWithNew).toBeDefined();

    // Old password fails on new envelope
    await expect(unlockWithPassword(password, newEnvelope)).rejects.toThrow();
  });
});
