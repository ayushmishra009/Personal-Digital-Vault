export interface PasswordGeneratorOptions {
  length?: number;
  uppercase?: boolean;
  lowercase?: boolean;
  numbers?: boolean;
  symbols?: boolean;
  excludeAmbiguous?: boolean;
}

const UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWERCASE = "abcdefghijklmnopqrstuvwxyz";
const NUMBERS = "0123456789";
const SYMBOLS = "!@#$%^&*()_+-=[]{}|;:,.<>?";
const AMBIGUOUS_CHARS = new Set(["0", "O", "l", "1", "I"]);

/**
 * Generate a random index in [0, max) with rejection sampling to eliminate modulo bias.
 */
function getSecureRandomIndex(max: number): number {
  if (max <= 0) throw new RangeError("Max must be positive");
  const maxUint32 = 0xffffffff;
  const limit = maxUint32 - (maxUint32 % max);
  const buffer = new Uint32Array(1);

  while (true) {
    crypto.getRandomValues(buffer);
    if (buffer[0] < limit) {
      return buffer[0] % max;
    }
  }
}

function filterAmbiguous(charset: string, exclude: boolean): string {
  if (!exclude) return charset;
  return charset
    .split("")
    .filter((c) => !AMBIGUOUS_CHARS.has(c))
    .join("");
}

export function generatePassword(
  options: PasswordGeneratorOptions = {},
): string {
  const length = Math.max(8, Math.min(128, options.length ?? 20));
  const useUpper = options.uppercase ?? true;
  const useLower = options.lowercase ?? true;
  const useNumbers = options.numbers ?? true;
  const useSymbols = options.symbols ?? true;
  const excludeAmbiguous = options.excludeAmbiguous ?? true;

  const charsets: string[] = [];
  if (useUpper) charsets.push(filterAmbiguous(UPPERCASE, excludeAmbiguous));
  if (useLower) charsets.push(filterAmbiguous(LOWERCASE, excludeAmbiguous));
  if (useNumbers) charsets.push(filterAmbiguous(NUMBERS, excludeAmbiguous));
  if (useSymbols) charsets.push(filterAmbiguous(SYMBOLS, excludeAmbiguous));

  if (charsets.length === 0) {
    throw new Error("At least one character set must be enabled");
  }

  const allChars = charsets.join("");
  const passwordChars: string[] = [];

  // Guarantee at least one character from each enabled charset
  for (const set of charsets) {
    const idx = getSecureRandomIndex(set.length);
    passwordChars.push(set[idx]);
  }

  // Fill remaining length from combined character set
  while (passwordChars.length < length) {
    const idx = getSecureRandomIndex(allChars.length);
    passwordChars.push(allChars[idx]);
  }

  // Cryptographic Fisher-Yates shuffle
  for (let i = passwordChars.length - 1; i > 0; i--) {
    const j = getSecureRandomIndex(i + 1);
    const temp = passwordChars[i];
    passwordChars[i] = passwordChars[j];
    passwordChars[j] = temp;
  }

  return passwordChars.join("");
}

export interface PasswordStrength {
  entropyBits: number;
  label: "Weak" | "Fair" | "Good" | "Strong" | "Very Strong";
  color: string;
}

export function estimatePasswordStrength(password: string): PasswordStrength {
  if (!password) {
    return { entropyBits: 0, label: "Weak", color: "#ef4444" };
  }

  let poolSize = 0;
  if (/[a-z]/.test(password)) poolSize += 26;
  if (/[A-Z]/.test(password)) poolSize += 26;
  if (/[0-9]/.test(password)) poolSize += 10;
  if (/[^a-zA-Z0-9]/.test(password)) poolSize += 32;

  const entropyBits = Math.round(password.length * Math.log2(poolSize || 1));

  if (entropyBits < 40) return { entropyBits, label: "Weak", color: "#ef4444" };
  if (entropyBits < 60) return { entropyBits, label: "Fair", color: "#f59e0b" };
  if (entropyBits < 80) return { entropyBits, label: "Good", color: "#eab308" };
  if (entropyBits < 100)
    return { entropyBits, label: "Strong", color: "#10b981" };
  return { entropyBits, label: "Very Strong", color: "#06b6d4" };
}
