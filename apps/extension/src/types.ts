export interface ExtensionStatus {
  isAuthenticated: boolean;
  isUnlocked: boolean;
  activeVaultId: string | null;
  currentTabUrl: string | null;
  currentDomain: string | null;
}

export interface CredentialSummary {
  id: string;
  title: string;
  username?: string;
  url?: string;
  domainMatch: boolean;
  tags: string[];
}

export interface CredentialFillPayload {
  username?: string;
  password?: string;
}

export interface FillResult {
  success: boolean;
  usernameFilled: boolean;
  passwordFilled: boolean;
  error?: string;
}

export type ExtensionMessage =
  | { type: "GET_STATUS" }
  | {
      type: "UNLOCK_VAULT";
      password?: string;
      recoverySecret?: string;
      vaultId?: string;
    }
  | { type: "LOCK_VAULT" }
  | { type: "LIST_CREDENTIALS"; query?: string }
  | { type: "CHECK_DOMAIN_MATCH"; recordId: string }
  | { type: "REQUEST_FILL"; recordId: string; allowMismatch?: boolean }
  | { type: "GET_ALLOWLIST" }
  | { type: "ADD_ALLOWLIST"; domain: string }
  | { type: "REMOVE_ALLOWLIST"; domain: string }
  | { type: "SEED_VAULT"; password?: string };

export type ContentScriptMessage =
  | { type: "PDV_DETECT_FORM" }
  | { type: "PDV_FILL_CREDENTIALS"; payload: CredentialFillPayload };
