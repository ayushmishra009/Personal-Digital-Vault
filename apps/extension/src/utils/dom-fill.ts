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

export function fillGeneratedPasswordInDocument(
  doc: Document,
  password: string,
): { success: boolean; filledCount: number } {
  let filledCount = 0;
  const passwordInputs = Array.from(
    doc.querySelectorAll<HTMLInputElement>(
      'input[type="password"], input[autocomplete="new-password"]',
    ),
  );

  if (passwordInputs.length > 0) {
    for (const input of passwordInputs) {
      setInputValue(input, password);
      filledCount++;
    }
  } else {
    // Fallback: check by name
    const namedInputs = Array.from(
      doc.querySelectorAll<HTMLInputElement>('input[name*="pass" i]'),
    );
    for (const input of namedInputs) {
      setInputValue(input, password);
      filledCount++;
    }
  }

  return {
    success: filledCount > 0,
    filledCount,
  };
}

export function captureCredentialsFromDocument(
  doc: Document,
  targetForm?: HTMLFormElement | null,
): { username?: string; password?: string } | null {
  const scope = targetForm || doc;

  // 1. Find password field with a value
  const passwordInputs = Array.from(
    scope.querySelectorAll<HTMLInputElement>(
      'input[type="password"], input[name*="pass" i]',
    ),
  );

  const filledPassword = passwordInputs.find(
    (input) => input.value && input.value.trim().length >= 4,
  );
  if (!filledPassword) return null;

  // 2. Find associated username/email field
  const formScope = filledPassword.form || scope;
  const usernameInputs = Array.from(
    formScope.querySelectorAll<HTMLInputElement>(
      'input[type="email"], input[autocomplete="username"], input[name*="user" i], input[name*="email" i], input[name*="login" i], input[type="text"]',
    ),
  );

  const filledUsername = usernameInputs.find(
    (input) =>
      input !== filledPassword && input.value && input.value.trim().length > 0,
  );

  return {
    username: filledUsername?.value?.trim(),
    password: filledPassword.value,
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
