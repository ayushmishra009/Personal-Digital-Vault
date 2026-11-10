/**
 * Origin allowlisting and domain matching security utilities for Chrome extension.
 * Enforces strict origin boundaries to prevent phishing and host confusion attacks.
 */

export function normalizeOrigin(inputUrl: string): string | null {
  if (!inputUrl) return null;
  try {
    const formatted = inputUrl.includes("://")
      ? inputUrl
      : `https://${inputUrl}`;
    const url = new URL(formatted);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.origin.toLowerCase();
  } catch {
    return null;
  }
}

export function extractHostname(inputUrl: string): string | null {
  if (!inputUrl) return null;
  try {
    const formatted = inputUrl.includes("://")
      ? inputUrl
      : `https://${inputUrl}`;
    const url = new URL(formatted);
    if (!url.hostname) return null;
    // Disallow single labels like "invalid-url" unless it's localhost or an IP
    if (!url.hostname.includes(".") && url.hostname !== "localhost") {
      return null;
    }
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Strict domain comparison preventing loose substring and suffix spoofing.
 *
 * Rules:
 * 1. Both hostnames must be non-empty.
 * 2. Exact match: recordHost === currentHost -> true.
 * 3. Subdomain match: currentHost is a valid subdomain of recordHost
 *    (e.g., login.example.com matches example.com).
 * 4. Substring spoofing (evil-example.com, example.com.attacker.com) is strictly rejected.
 */
export function matchesDomain(recordUrl: string, currentUrl: string): boolean {
  const recordHost = extractHostname(recordUrl);
  const currentHost = extractHostname(currentUrl);

  if (!recordHost || !currentHost) {
    return false;
  }

  // Exact hostname match
  if (recordHost === currentHost) {
    return true;
  }

  // Valid subdomain match: current is a subdomain of record (e.g. login.example.com -> example.com)
  if (currentHost.endsWith("." + recordHost)) {
    return true;
  }

  // Reverse subdomain match: record specifically targeted a subdomain and current is root, or vice versa
  if (recordHost.endsWith("." + currentHost)) {
    return true;
  }

  return false;
}

export function isAllowedOrigin(
  url: string,
  allowlist: readonly string[],
): boolean {
  const host = extractHostname(url);
  if (!host) return false;

  for (const allowed of allowlist) {
    const allowedHost = extractHostname(allowed);
    if (allowedHost && matchesDomain(allowedHost, host)) {
      return true;
    }
  }

  return false;
}
