import type { FillResult } from "../types";

export function fillCredentialsInDocument(
  doc: Document,
  username?: string,
  password?: string,
): FillResult {
  let usernameFilled = false;
  let passwordFilled = false;

  // 1. Locate password field
  const passwordInput = doc.querySelector<HTMLInputElement>(
    'input[type="password"], input[autocomplete="current-password"], input[autocomplete="new-password"], input[name*="pass" i]',
  );

  if (password && passwordInput) {
    setInputValue(passwordInput, password);
    passwordFilled = true;
  }

  // 2. Locate username/email field
  let usernameInput: HTMLInputElement | null = null;
  if (passwordInput && passwordInput.form) {
    usernameInput = passwordInput.form.querySelector<HTMLInputElement>(
      'input[type="email"], input[autocomplete="username"], input[name*="user" i], input[name*="email" i], input[name*="login" i], input[type="text"]',
    );
  }
  if (!usernameInput) {
    usernameInput = doc.querySelector<HTMLInputElement>(
      'input[type="email"], input[autocomplete="username"], input[name*="user" i], input[name*="email" i], input[name*="login" i]',
    );
  }

  if (username && usernameInput) {
    setInputValue(usernameInput, username);
    usernameFilled = true;
  }

  // CRITICAL: NEVER submit the form automatically!
  return {
    success: usernameFilled || passwordFilled,
    usernameFilled,
    passwordFilled,
  };
}

export function setInputValue(input: HTMLInputElement, value: string): void {
  // Use prototype setter to trigger React/Vue synthetic events if available
  const nativeSetter =
    typeof window !== "undefined" && window.HTMLInputElement
      ? Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        )?.set
      : undefined;

  if (nativeSetter) {
    nativeSetter.call(input, value);
  } else {
    input.value = value;
  }

  if (typeof Event !== "undefined") {
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
}
