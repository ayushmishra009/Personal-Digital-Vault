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

export interface CapturedCredential {
  username?: string;
  password?: string;
  url: string;
  title: string;
  timestamp: number;
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
  | { type: "SEED_VAULT"; password?: string }
  | {
      type: "GENERATE_PASSWORD";
      length?: number;
      uppercase?: boolean;
      lowercase?: boolean;
      numbers?: boolean;
      symbols?: boolean;
    }
  | {
      type: "GENERATE_AND_FILL";
      options?: {
        length?: number;
        uppercase?: boolean;
        lowercase?: boolean;
        numbers?: boolean;
        symbols?: boolean;
      };
    }
  | {
      type: "SAVE_CREDENTIAL";
      title: string;
      url: string;
      username?: string;
      password?: string;
      notes?: string;
      tags?: string[];
    }
  | { type: "CAPTURE_CREDENTIALS"; data: CapturedCredential }
  | { type: "GET_PENDING_CAPTURE" }
  | { type: "CLEAR_PENDING_CAPTURE" };

export type ContentScriptMessage =
  | { type: "PDV_DETECT_FORM" }
  | { type: "PDV_FILL_CREDENTIALS"; payload: CredentialFillPayload }
  | { type: "PDV_FILL_GENERATED_PASSWORD"; payload: { password: string } }
  | { type: "PDV_SHOW_SAVE_PROMPT"; payload: CapturedCredential };
