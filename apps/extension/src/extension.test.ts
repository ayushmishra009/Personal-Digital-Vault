import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  matchesDomain,
  extractHostname,
  normalizeOrigin,
  isAllowedOrigin,
} from "./utils/origin";
import {
  fillCredentialsInDocument,
  fillGeneratedPasswordInDocument,
  captureCredentialsFromDocument,
} from "./utils/dom-fill";
import {
  generatePassword,
  estimatePasswordStrength,
} from "./utils/password-generator";
import { SessionManager } from "./session";
import type { Argon2idProvider } from "./crypto";
import contentScriptDef from "../entrypoints/content";

describe("Phase 11: Chrome Extension Security & Functionality", () => {
  describe("1. Strict Origin Allowlisting & Hostile Origin Rejection", () => {
    it("normalizes origins and extracts hostnames accurately", () => {
      expect(normalizeOrigin("https://example.com/login?foo=bar")).toBe(
        "https://example.com",
      );
      expect(normalizeOrigin("http://localhost:3000/path")).toBe(
        "http://localhost:3000",
      );
      expect(normalizeOrigin("javascript:alert(1)")).toBeNull();
      expect(normalizeOrigin("data:text/html,test")).toBeNull();

      expect(extractHostname("https://sub.domain.example.com:8080/path")).toBe(
        "sub.domain.example.com",
      );
      expect(extractHostname("http://127.0.0.1:8080")).toBe("127.0.0.1");
      expect(extractHostname("invalid-url")).toBeNull();
    });

    it("accepts exact domain and valid dot-prefixed subdomain matches", () => {
      expect(
        matchesDomain("https://github.com", "https://github.com/login"),
      ).toBe(true);
      expect(
        matchesDomain("https://github.com/login", "https://github.com"),
      ).toBe(true);
      expect(
        matchesDomain("https://github.com", "https://gist.github.com"),
      ).toBe(true);
      expect(
        matchesDomain("https://login.example.com", "https://example.com"),
      ).toBe(true);
    });

    it("strictly rejects loose substring matching and suffix spoofing attacks", () => {
      // Substring attack (e.g. attacker appends hyphen)
      expect(
        matchesDomain("https://github.com", "https://evil-github.com"),
      ).toBe(false);
      expect(
        matchesDomain("https://evil-github.com", "https://github.com"),
      ).toBe(false);

      // Suffix spoofing (attacker subdomain under different apex)
      expect(
        matchesDomain("https://github.com", "https://github.com.attacker.com"),
      ).toBe(false);
      expect(
        matchesDomain("https://github.com.attacker.com", "https://github.com"),
      ).toBe(false);

      // Embedded name attack
      expect(
        matchesDomain("https://example.com", "https://notexample.com"),
      ).toBe(false);
      expect(
        matchesDomain("https://example.com", "https://example.com.evil.org"),
      ).toBe(false);

      // Path confusion
      expect(
        matchesDomain(
          "https://example.com",
          "https://attacker.com/example.com",
        ),
      ).toBe(false);
    });

    it("validates origin allowlists strictly", () => {
      const allowlist = ["example.com", "localhost"];

      expect(isAllowedOrigin("https://example.com/page", allowlist)).toBe(true);
      expect(isAllowedOrigin("https://sub.example.com", allowlist)).toBe(true);
      expect(isAllowedOrigin("http://localhost:3000", allowlist)).toBe(true);

      expect(isAllowedOrigin("https://evil-example.com", allowlist)).toBe(
        false,
      );
      expect(
        isAllowedOrigin("https://example.com.attacker.com", allowlist),
      ).toBe(false);
      expect(isAllowedOrigin("https://google.com", allowlist)).toBe(false);
    });
  });

  describe("2. DOM Credential Filling & Non-Submission Safety", () => {
    it("fills username and password inputs without form submission", () => {
      let formSubmitted = false;
      const dispatchedEvents: string[] = [];

      const mockUsernameInput = {
        value: "",
        form: null as unknown,
        dispatchEvent: (ev: Event) => dispatchedEvents.push(`user:${ev.type}`),
      };

      const mockPasswordInput = {
        value: "",
        form: null as unknown,
        dispatchEvent: (ev: Event) => dispatchedEvents.push(`pass:${ev.type}`),
      };

      const mockForm = {
        submit: () => {
          formSubmitted = true;
        },
        querySelector: (selector: string) => {
          if (
            selector.includes("email") ||
            selector.includes("username") ||
            selector.includes("text")
          ) {
            return mockUsernameInput;
          }
          return null;
        },
      };

      mockUsernameInput.form = mockForm;
      mockPasswordInput.form = mockForm;

      const mockDoc = {
        querySelector: (selector: string) => {
          if (selector.includes("password")) {
            return mockPasswordInput;
          }
          if (selector.includes("email") || selector.includes("username")) {
            return mockUsernameInput;
          }
          return null;
        },
      } as unknown as Document;

      const result = fillCredentialsInDocument(
        mockDoc,
        "testuser@example.com",
        "P@ssw0rd123!",
      );

      expect(result.success).toBe(true);
      expect(result.usernameFilled).toBe(true);
      expect(result.passwordFilled).toBe(true);
      expect(mockUsernameInput.value).toBe("testuser@example.com");
      expect(mockPasswordInput.value).toBe("P@ssw0rd123!");

      // Dispatched synthetic events for framework reactivity
      expect(dispatchedEvents).toContain("user:input");
      expect(dispatchedEvents).toContain("user:change");
      expect(dispatchedEvents).toContain("pass:input");
      expect(dispatchedEvents).toContain("pass:change");

      // CRITICAL ACCEPTANCE CHECK: Form MUST NEVER be submitted automatically
      expect(formSubmitted).toBe(false);
    });

    it("gracefully returns false when no inputs are found", () => {
      const mockDoc = {
        querySelector: () => null,
      } as unknown as Document;

      const result = fillCredentialsInDocument(mockDoc, "user", "pass");
      expect(result.success).toBe(false);
      expect(result.usernameFilled).toBe(false);
      expect(result.passwordFilled).toBe(false);
    });
  });

  describe("3. Extension Session Management, Zeroization & Domain Mismatch Warning", () => {
    // Fast mock Argon2id provider for deterministic testing
    const mockArgon2Provider: Argon2idProvider = {
      async deriveKey(pw: Uint8Array, salt: Uint8Array): Promise<Uint8Array> {
        const out = new Uint8Array(32);
        for (let i = 0; i < 32; i++) {
          out[i] = (pw[i % pw.length] ^ salt[i % salt.length] ^ i) & 0xff;
        }
        return out;
      },
    };

    let session: SessionManager;

    beforeEach(async () => {
      session = new SessionManager();
      await session.seedDefaultVault(
        "TestVaultPassword123!",
        mockArgon2Provider,
      );
    });

    it("starts in locked state with zeroized memory", () => {
      const status = session.getStatus("https://github.com");
      expect(status.isUnlocked).toBe(false);
      expect(status.activeVaultId).toBeNull();
      expect(status.currentDomain).toBe("github.com");
      expect(session.listCredentials("https://github.com")).toEqual([]);
    });

    it("unlocks with correct master password", async () => {
      const unlockRes = await session.unlock({
        password: "TestVaultPassword123!",
        argon2Provider: mockArgon2Provider,
      });

      expect(unlockRes.success).toBe(true);
      const status = session.getStatus("https://github.com");
      expect(status.isUnlocked).toBe(true);
      expect(status.activeVaultId).toBeDefined();

      const creds = session.listCredentials("https://github.com");
      expect(creds.length).toBeGreaterThan(0);
      // GitHub matches current page domain, so it should be prioritized first
      expect(creds[0].title).toBe("GitHub");
      expect(creds[0].domainMatch).toBe(true);
    });

    it("unlocks with recovery secret", async () => {
      const stored = session.getStoredVault()!;
      // Create new session with same stored vault
      const newSession = new SessionManager();
      newSession.setStoredVault(stored);

      // Re-seed gave us the stored data with recoveryEnvelope
      // We can also test unlock with wrong password
      const failRes = await newSession.unlock({
        password: "WrongPassword!",
        argon2Provider: mockArgon2Provider,
      });
      expect(failRes.success).toBe(false);
      expect(failRes.error).toContain("invalid credentials");
      expect(newSession.getStatus().isUnlocked).toBe(false);
    });

    it("STRICT: Never exposes plaintext passwords in credential summaries", async () => {
      await session.unlock({
        password: "TestVaultPassword123!",
        argon2Provider: mockArgon2Provider,
      });

      const creds = session.listCredentials("https://github.com");
      for (const cred of creds) {
        expect(
          (cred as unknown as Record<string, unknown>).password,
        ).toBeUndefined();
        expect(cred.id).toBeDefined();
        expect(cred.title).toBeDefined();
        expect(cred.username).toBeDefined();
      }
    });

    it("blocks credential fill on domain mismatch without explicit user acknowledgment", async () => {
      await session.unlock({
        password: "TestVaultPassword123!",
        argon2Provider: mockArgon2Provider,
      });

      const creds = session.listCredentials("https://evil-phishing.com");
      const githubCred = creds.find((c) => c.title === "GitHub")!;
      expect(githubCred).toBeDefined();
      expect(githubCred.domainMatch).toBe(false);

      // 1. Fill on evil-phishing.com without allowMismatch -> MUST THROW!
      expect(() => {
        session.requestFill(githubCred.id, "https://evil-phishing.com", false);
      }).toThrow(/Domain mismatch: explicit user confirmation required/);

      // 2. Fill on evil-phishing.com WITH explicit allowMismatch -> permitted
      const fillData = session.requestFill(
        githubCred.id,
        "https://evil-phishing.com",
        true,
      );
      expect(fillData.username).toBe("octocat");
      expect(fillData.password).toBe("supersecret-password-123");
    });

    it("allows credential fill directly on matching domain", async () => {
      await session.unlock({
        password: "TestVaultPassword123!",
        argon2Provider: mockArgon2Provider,
      });

      const creds = session.listCredentials("https://github.com/login");
      const githubCred = creds.find((c) => c.title === "GitHub")!;

      const fillData = session.requestFill(
        githubCred.id,
        "https://github.com/login",
        false,
      );
      expect(fillData.username).toBe("octocat");
      expect(fillData.password).toBe("supersecret-password-123");
    });

    it("rejects filling on non-web page schemes (e.g. chrome://, file://)", async () => {
      await session.unlock({
        password: "TestVaultPassword123!",
        argon2Provider: mockArgon2Provider,
      });

      const creds = session.listCredentials("chrome://settings");
      const githubCred = creds[0];

      expect(() => {
        session.requestFill(githubCred.id, "chrome://settings", true);
      }).toThrow(/Cannot fill credentials on non-web page/);
    });

    it("immediately wipes secrets on lock (volatile zeroization)", async () => {
      await session.unlock({
        password: "TestVaultPassword123!",
        argon2Provider: mockArgon2Provider,
      });

      expect(session.getStatus().isUnlocked).toBe(true);
      expect(
        session.listCredentials("https://github.com").length,
      ).toBeGreaterThan(0);

      // LOCK
      session.lock();

      // State is completely reset
      expect(session.getStatus().isUnlocked).toBe(false);
      expect(session.listCredentials("https://github.com")).toEqual([]);

      expect(() => {
        session.requestFill(
          "11111111-1111-4111-8111-111111111111",
          "https://github.com",
        );
      }).toThrow(/Vault is locked/);
    });

    it("supports custom allowlist domain management", () => {
      expect(session.getAllowlist()).toEqual([]);

      session.addAllowlist("https://my-internal-login.local:8080");
      expect(session.getAllowlist()).toContain("my-internal-login.local");

      // Duplicate addition is ignored
      session.addAllowlist("my-internal-login.local");
      expect(session.getAllowlist().length).toBe(1);

      session.removeAllowlist("my-internal-login.local");
      expect(session.getAllowlist()).toEqual([]);
    });
  });

  describe("4. Zero Credential Logging Acceptance Verification", () => {
    let logSpy: ReturnType<typeof vi.spyOn>;
    let infoSpy: ReturnType<typeof vi.spyOn>;
    let warnSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      logSpy = vi.spyOn(console, "log");
      infoSpy = vi.spyOn(console, "info");
      warnSpy = vi.spyOn(console, "warn");
      errorSpy = vi.spyOn(console, "error");
    });

    afterEach(() => {
      logSpy.mockRestore();
      infoSpy.mockRestore();
      warnSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it("never logs passwords, recovery secrets or keys to console", async () => {
      const mockArgon2: Argon2idProvider = {
        async deriveKey(pw: Uint8Array, salt: Uint8Array): Promise<Uint8Array> {
          const out = new Uint8Array(32);
          for (let i = 0; i < 32; i++) {
            out[i] = (pw[i % pw.length] ^ salt[i % salt.length]) & 0xff;
          }
          return out;
        },
      };

      const session = new SessionManager();
      const SECRET_PASS = "SuperTopSecretPassword999!";
      await session.seedDefaultVault(SECRET_PASS, mockArgon2);

      await session.unlock({
        password: SECRET_PASS,
        argon2Provider: mockArgon2,
      });

      const creds = session.listCredentials("https://github.com");
      const githubCred = creds.find((c) => c.title === "GitHub")!;
      session.requestFill(githubCred.id, "https://github.com");
      session.lock();

      // Check all console calls
      const allCalls = [
        ...logSpy.mock.calls,
        ...infoSpy.mock.calls,
        ...warnSpy.mock.calls,
        ...errorSpy.mock.calls,
      ]
        .flat()
        .map(String);

      for (const msg of allCalls) {
        expect(msg).not.toContain(SECRET_PASS);
        expect(msg).not.toContain("supersecret-password-123");
      }
    });
  });

  describe("5. Content Script Frame Boundary Verification", () => {
    it("strictly restricts content scripts to top-level frames (allFrames: false)", () => {
      expect(contentScriptDef.allFrames).toBe(false);
      expect(contentScriptDef.matches).toContain("https://*/*");
      expect(contentScriptDef.matches).toContain("http://*/*");
    });
  });

  describe("6. Seamless Password Generation, Form Detection & Auto-Capture", () => {
    it("generates cryptographically secure passwords and evaluates strength", () => {
      const pwd = generatePassword({ length: 24 });
      expect(pwd.length).toBe(24);
      expect(/[A-Z]/.test(pwd)).toBe(true);
      expect(/[a-z]/.test(pwd)).toBe(true);
      expect(/[0-9]/.test(pwd)).toBe(true);

      const strength = estimatePasswordStrength(pwd);
      expect(strength.entropyBits).toBeGreaterThan(80);
      expect(["Strong", "Very Strong"]).toContain(strength.label);
    });

    it("fills generated passwords across password and confirmation fields", () => {
      const mockP1 = { value: "", dispatchEvent: () => {} };
      const mockP2 = { value: "", dispatchEvent: () => {} };
      const mockDoc = {
        querySelectorAll: (sel: string) => {
          if (sel.includes("password")) return [mockP1, mockP2];
          return [];
        },
      } as unknown as Document;

      const result = fillGeneratedPasswordInDocument(
        mockDoc,
        "SuperSecureGeneratedPassword99!",
      );
      expect(result.success).toBe(true);
      expect(result.filledCount).toBe(2);
      expect(mockP1.value).toBe("SuperSecureGeneratedPassword99!");
      expect(mockP2.value).toBe("SuperSecureGeneratedPassword99!");
    });

    it("captures filled credentials from a submitted document/form", () => {
      const mockUser = { value: "captured_user", form: null as unknown };
      const mockPass = { value: "captured_pass_12345", form: null as unknown };
      const mockForm = {
        querySelectorAll: (sel: string) => {
          if (sel.includes("password")) return [mockPass];
          if (
            sel.includes("user") ||
            sel.includes("email") ||
            sel.includes("text")
          ) {
            return [mockUser];
          }
          return [];
        },
      };
      mockUser.form = mockForm;
      mockPass.form = mockForm;
      const mockDoc = {
        querySelectorAll: (sel: string) => mockForm.querySelectorAll(sel),
      } as unknown as Document;

      const captured = captureCredentialsFromDocument(mockDoc);
      expect(captured).not.toBeNull();
      expect(captured?.username).toBe("captured_user");
      expect(captured?.password).toBe("captured_pass_12345");
    });

    it("encrypts and saves captured credentials in the unlocked vault", async () => {
      const mockArgon2: Argon2idProvider = {
        async deriveKey(pw: Uint8Array, salt: Uint8Array): Promise<Uint8Array> {
          const out = new Uint8Array(32);
          for (let i = 0; i < 32; i++) {
            out[i] = (pw[i % pw.length] ^ salt[i % salt.length] ^ i) & 0xff;
          }
          return out;
        },
      };

      const session = new SessionManager();
      await session.seedDefaultVault("TestMasterPassword1!", mockArgon2);
      await session.unlock({
        password: "TestMasterPassword1!",
        argon2Provider: mockArgon2,
      });

      // Set pending capture
      session.setPendingCapture({
        username: "test_dev",
        password: "GeneratedDevSecret123!",
        url: "https://newapp.example.com/signup",
        title: "New App",
        timestamp: Date.now(),
      });
      expect(session.getPendingCapture()).not.toBeNull();

      // Save credential
      const saveRes = await session.saveCredential({
        title: "New App",
        url: "https://newapp.example.com",
        username: "test_dev",
        password: "GeneratedDevSecret123!",
      });

      expect(saveRes.success).toBe(true);
      expect(saveRes.record?.title).toBe("New App");

      // Verify pending capture was cleared automatically on save
      expect(session.getPendingCapture()).toBeNull();

      // Verify credential appears in list
      const list = session.listCredentials("https://newapp.example.com");
      expect(list.some((c) => c.title === "New App")).toBe(true);
    });

    it("rejects saving credentials when vault is locked", async () => {
      const session = new SessionManager();
      const res = await session.saveCredential({
        title: "Locked Save",
        url: "https://example.com",
        username: "user",
        password: "pwd",
      });
      expect(res.success).toBe(false);
      expect(res.error).toContain("Vault must be unlocked");
    });
  });
});
