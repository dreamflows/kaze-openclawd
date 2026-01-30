import type { ClawdbotConfig } from "clawdbot/plugin-sdk";
import type { LarkChannelConfig, ResolvedLarkAccount, LarkAccountConfig } from "./types.js";

export const DEFAULT_ACCOUNT_ID = "default";

// Get lark channel config from clawdbot config
function getLarkConfig(cfg: ClawdbotConfig): LarkChannelConfig | undefined {
  return cfg.channels?.lark as LarkChannelConfig | undefined;
}

// List all configured lark account IDs
export function listLarkAccountIds(cfg: ClawdbotConfig): string[] {
  const larkConfig = getLarkConfig(cfg);
  if (!larkConfig) return [];

  const accountIds = new Set<string>();

  // Check if base config has credentials (default account)
  if (larkConfig.appId || process.env.LARK_APP_ID) {
    accountIds.add(DEFAULT_ACCOUNT_ID);
  }

  // Add named accounts
  if (larkConfig.accounts) {
    for (const accountId of Object.keys(larkConfig.accounts)) {
      accountIds.add(accountId);
    }
  }

  return Array.from(accountIds);
}

// Resolve default account ID
export function resolveDefaultLarkAccountId(cfg: ClawdbotConfig): string {
  const accountIds = listLarkAccountIds(cfg);
  return accountIds.length > 0 ? accountIds[0] : DEFAULT_ACCOUNT_ID;
}

// Normalize account ID
export function normalizeAccountId(accountId?: string): string {
  const trimmed = accountId?.trim().toLowerCase() ?? "";
  if (!trimmed || trimmed === "default") return DEFAULT_ACCOUNT_ID;
  return trimmed;
}

// Resolve a specific lark account
export function resolveLarkAccount(params: {
  cfg: ClawdbotConfig;
  accountId?: string;
}): ResolvedLarkAccount {
  const { cfg, accountId } = params;
  const resolvedAccountId = normalizeAccountId(accountId);
  const larkConfig = getLarkConfig(cfg);

  // Check for named account first
  const accountConfig =
    resolvedAccountId !== DEFAULT_ACCOUNT_ID
      ? larkConfig?.accounts?.[resolvedAccountId]
      : undefined;

  // Resolve credentials with fallback chain: account config -> base config -> env
  const appIdFromAccount = accountConfig?.appId?.trim();
  const appIdFromBase = larkConfig?.appId?.trim();
  const appIdFromEnv = process.env.LARK_APP_ID?.trim();

  const appSecretFromAccount = accountConfig?.appSecret?.trim();
  const appSecretFromBase = larkConfig?.appSecret?.trim();
  const appSecretFromEnv = process.env.LARK_APP_SECRET?.trim();

  const appId = appIdFromAccount || appIdFromBase || appIdFromEnv || "";
  const appSecret = appSecretFromAccount || appSecretFromBase || appSecretFromEnv || "";

  // Determine source of credentials
  let appIdSource: "config" | "env" | "none" = "none";
  if (appIdFromAccount || appIdFromBase) {
    appIdSource = "config";
  } else if (appIdFromEnv) {
    appIdSource = "env";
  }

  let appSecretSource: "config" | "env" | "none" = "none";
  if (appSecretFromAccount || appSecretFromBase) {
    appSecretSource = "config";
  } else if (appSecretFromEnv) {
    appSecretSource = "env";
  }

  // Resolve other config values
  const encryptKey =
    accountConfig?.encryptKey?.trim() ||
    larkConfig?.encryptKey?.trim() ||
    process.env.LARK_ENCRYPT_KEY?.trim();

  const verificationToken =
    accountConfig?.verificationToken?.trim() ||
    larkConfig?.verificationToken?.trim() ||
    process.env.LARK_VERIFICATION_TOKEN?.trim();

  const botOpenId =
    accountConfig?.botOpenId?.trim() ||
    larkConfig?.botOpenId?.trim() ||
    process.env.LARK_BOT_OPEN_ID?.trim();

  // Determine if enabled
  const enabled =
    resolvedAccountId !== DEFAULT_ACCOUNT_ID
      ? accountConfig?.enabled !== false
      : larkConfig?.enabled !== false;

  // Build merged config for this account
  const mergedConfig: LarkAccountConfig = {
    ...larkConfig,
    ...accountConfig,
    appId,
    appSecret,
    encryptKey,
    verificationToken,
    botOpenId,
  };

  return {
    accountId: resolvedAccountId,
    name: accountConfig?.name || (resolvedAccountId === DEFAULT_ACCOUNT_ID ? undefined : resolvedAccountId),
    enabled,
    appId,
    appSecret,
    encryptKey,
    verificationToken,
    appIdSource,
    appSecretSource,
    config: mergedConfig,
  };
}

// List all enabled lark accounts
export function listEnabledLarkAccounts(cfg: ClawdbotConfig): ResolvedLarkAccount[] {
  const accountIds = listLarkAccountIds(cfg);
  return accountIds
    .map((accountId) => resolveLarkAccount({ cfg, accountId }))
    .filter((account) => account.enabled && account.appId && account.appSecret);
}
