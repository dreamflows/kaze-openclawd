import {
  DEFAULT_ACCOUNT_ID,
  type ChannelPlugin,
} from "clawdbot/plugin-sdk";

import {
  listLarkAccountIds,
  resolveLarkAccount,
  resolveDefaultLarkAccountId,
  listEnabledLarkAccounts,
  normalizeAccountId,
} from "./accounts.js";
import { sendMessageLark, probeLark } from "./send.js";
import { monitorLarkProvider } from "./monitor.js";
import { getLarkRuntime } from "./runtime.js";
import type { ResolvedLarkAccount } from "./types.js";

// Channel metadata
const meta = {
  id: "lark" as const,
  name: "Lark",
  displayName: "Lark (Feishu)",
  icon: "💬",
  docsUrl: "https://docs.clawd.bot/channels/lark",
};

// Normalize target ID for messaging
function normalizeLarkMessagingTarget(target: string): string {
  return target
    .trim()
    .replace(/^lark:/i, "")
    .replace(/^feishu:/i, "")
    .trim();
}

// Check if target looks like a Lark ID
function looksLikeLarkTargetId(target: string): boolean {
  const normalized = normalizeLarkMessagingTarget(target);
  // Lark chat IDs typically start with 'oc_' for group chats
  // or are user open_ids
  return /^oc_[\w-]+$/.test(normalized) || /^ou_[\w-]+$/.test(normalized) || normalized.length > 10;
}

export const larkPlugin: ChannelPlugin<ResolvedLarkAccount> = {
  id: "lark",
  meta: {
    ...meta,
    quickstartAllowFrom: true,
  },
  capabilities: {
    chatTypes: ["direct", "group"],
    reactions: false,
    threads: true,
    media: true,
    nativeCommands: false,
  },
  reload: { configPrefixes: ["channels.lark"] },
  config: {
    listAccountIds: (cfg) => listLarkAccountIds(cfg),
    resolveAccount: (cfg, accountId) => resolveLarkAccount({ cfg, accountId }),
    defaultAccountId: (cfg) => resolveDefaultLarkAccountId(cfg),
    setAccountEnabled: ({ cfg, accountId, enabled }) => {
      const resolvedAccountId = normalizeAccountId(accountId);
      const updated = { ...cfg };

      if (resolvedAccountId === DEFAULT_ACCOUNT_ID) {
        updated.channels = {
          ...updated.channels,
          lark: {
            ...updated.channels?.lark,
            enabled,
          },
        };
      } else {
        updated.channels = {
          ...updated.channels,
          lark: {
            ...updated.channels?.lark,
            accounts: {
              ...updated.channels?.lark?.accounts,
              [resolvedAccountId]: {
                ...updated.channels?.lark?.accounts?.[resolvedAccountId],
                enabled,
              },
            },
          },
        };
      }

      return updated;
    },
    deleteAccount: ({ cfg, accountId }) => {
      const resolvedAccountId = normalizeAccountId(accountId);
      const updated = { ...cfg };

      if (resolvedAccountId === DEFAULT_ACCOUNT_ID) {
        if (updated.channels?.lark) {
          const { appId, appSecret, encryptKey, verificationToken, ...rest } = updated.channels.lark;
          updated.channels = {
            ...updated.channels,
            lark: rest,
          };
        }
      } else {
        const accounts = { ...updated.channels?.lark?.accounts };
        delete accounts[resolvedAccountId];
        updated.channels = {
          ...updated.channels,
          lark: {
            ...updated.channels?.lark,
            accounts: Object.keys(accounts).length > 0 ? accounts : undefined,
          },
        };
      }

      return updated;
    },
    isConfigured: (account) => Boolean(account.appId && account.appSecret),
    describeAccount: (account) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.appId && account.appSecret),
      appIdSource: account.appIdSource,
      appSecretSource: account.appSecretSource,
    }),
    resolveAllowFrom: ({ cfg, accountId }) =>
      (resolveLarkAccount({ cfg, accountId }).config.allowFrom ?? []).map((entry) => String(entry)),
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.replace(/^(lark|feishu):/i, ""))
        .map((entry) => entry.toLowerCase()),
  },
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }) => {
      const resolvedAccountId = accountId ?? account.accountId ?? DEFAULT_ACCOUNT_ID;
      const useAccountPath = Boolean(cfg.channels?.lark?.accounts?.[resolvedAccountId]);
      const basePath = useAccountPath
        ? `channels.lark.accounts.${resolvedAccountId}.`
        : "channels.lark.";
      return {
        policy: account.config.dmPolicy ?? "pairing",
        allowFrom: account.config.allowFrom ?? [],
        policyPath: `${basePath}dmPolicy`,
        allowFromPath: basePath,
        approveHint: `clawdbot config set channels.lark.allowFrom <user_open_id>`,
        normalizeEntry: (raw) => raw.replace(/^(lark|feishu):/i, ""),
      };
    },
    collectWarnings: ({ account, cfg }) => {
      const defaultGroupPolicy = cfg.channels?.defaults?.groupPolicy;
      const groupPolicy = account.config.groupPolicy ?? defaultGroupPolicy ?? "allowlist";
      if (groupPolicy !== "open") return [];
      return [
        `- Lark groups: groupPolicy="open" with no group allowlist; any group can add the bot.`,
      ];
    },
  },
  groups: {
    resolveRequireMention: ({ cfg, accountId, groupId }) => {
      const account = resolveLarkAccount({ cfg, accountId });
      const groups = account.config.groups;
      const groupConfig = groups?.[groupId] ?? groups?.["*"];
      return groupConfig?.requireMention ?? true;
    },
    resolveToolPolicy: ({ cfg, accountId, groupId }) => {
      const account = resolveLarkAccount({ cfg, accountId });
      const groups = account.config.groups;
      const groupConfig = groups?.[groupId] ?? groups?.["*"];
      return groupConfig?.toolPolicy ?? "default";
    },
  },
  threading: {
    resolveReplyToMode: ({ cfg }) => cfg.channels?.lark?.replyToMode ?? "first",
  },
  messaging: {
    normalizeTarget: normalizeLarkMessagingTarget,
    targetResolver: {
      looksLikeId: looksLikeLarkTargetId,
      hint: "<chatId|openId>",
    },
  },
  directory: {
    self: async () => null,
    listPeers: async () => [],
    listGroups: async () => [],
  },
  setup: {
    resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
    applyAccountName: ({ cfg, accountId, name }) => {
      const resolvedAccountId = normalizeAccountId(accountId);
      if (resolvedAccountId === DEFAULT_ACCOUNT_ID) {
        return cfg;
      }
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          lark: {
            ...cfg.channels?.lark,
            accounts: {
              ...cfg.channels?.lark?.accounts,
              [resolvedAccountId]: {
                ...cfg.channels?.lark?.accounts?.[resolvedAccountId],
                name,
              },
            },
          },
        },
      };
    },
    validateInput: ({ accountId, input }) => {
      if (input.useEnv && accountId !== DEFAULT_ACCOUNT_ID) {
        return "Lark env credentials can only be used for the default account.";
      }
      if (!input.useEnv && (!input.appId || !input.appSecret)) {
        return "Lark requires --app-id and --app-secret (or --use-env).";
      }
      return null;
    },
    applyAccountConfig: ({ cfg, accountId, input }) => {
      const resolvedAccountId = normalizeAccountId(accountId);
      if (resolvedAccountId === DEFAULT_ACCOUNT_ID) {
        return {
          ...cfg,
          channels: {
            ...cfg.channels,
            lark: {
              ...cfg.channels?.lark,
              enabled: true,
              ...(input.useEnv
                ? {}
                : {
                    ...(input.appId ? { appId: input.appId } : {}),
                    ...(input.appSecret ? { appSecret: input.appSecret } : {}),
                  }),
            },
          },
        };
      }
      return {
        ...cfg,
        channels: {
          ...cfg.channels,
          lark: {
            ...cfg.channels?.lark,
            enabled: true,
            accounts: {
              ...cfg.channels?.lark?.accounts,
              [resolvedAccountId]: {
                ...cfg.channels?.lark?.accounts?.[resolvedAccountId],
                enabled: true,
                ...(input.appId ? { appId: input.appId } : {}),
                ...(input.appSecret ? { appSecret: input.appSecret } : {}),
              },
            },
          },
        },
      };
    },
  },
  outbound: {
    deliveryMode: "direct",
    chunker: (text, limit) => getLarkRuntime().channel.text.chunkMarkdownText(text, limit),
    chunkerMode: "markdown",
    textChunkLimit: 4000,
    sendText: async ({ to, text, accountId, replyToId }) => {
      const result = await sendMessageLark(to, text, {
        accountId: accountId ?? undefined,
        replyToId: replyToId ?? undefined,
      });
      return { channel: "lark", ...result };
    },
    sendMedia: async ({ to, text, mediaUrl, accountId, replyToId }) => {
      const result = await sendMessageLark(to, text, {
        accountId: accountId ?? undefined,
        mediaUrl: mediaUrl ?? undefined,
        replyToId: replyToId ?? undefined,
      });
      return { channel: "lark", ...result };
    },
  },
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    buildChannelSummary: ({ snapshot }) => ({
      configured: snapshot.configured ?? false,
      appIdSource: snapshot.appIdSource ?? "none",
      appSecretSource: snapshot.appSecretSource ?? "none",
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt ?? null,
    }),
    probeAccount: async ({ account, timeoutMs }) => {
      if (!account.appId || !account.appSecret) {
        return { ok: false, error: "missing credentials" };
      }
      return await probeLark(account.appId, account.appSecret, timeoutMs);
    },
    buildAccountSnapshot: ({ account, runtime, probe }) => {
      const configured = Boolean(account.appId && account.appSecret);
      return {
        accountId: account.accountId,
        name: account.name,
        enabled: account.enabled,
        configured,
        appIdSource: account.appIdSource,
        appSecretSource: account.appSecretSource,
        running: runtime?.running ?? false,
        lastStartAt: runtime?.lastStartAt ?? null,
        lastStopAt: runtime?.lastStopAt ?? null,
        lastError: runtime?.lastError ?? null,
        probe,
        lastInboundAt: runtime?.lastInboundAt ?? null,
        lastOutboundAt: runtime?.lastOutboundAt ?? null,
      };
    },
  },
  gateway: {
    startAccount: async (ctx) => {
      const account = ctx.account;
      ctx.log?.info(`[${account.accountId}] starting Lark provider`);
      return monitorLarkProvider({
        accountId: account.accountId,
        config: ctx.cfg,
        runtime: ctx.runtime,
        abortSignal: ctx.abortSignal,
        webhookPort: account.config.webhookPort,
        webhookPath: account.config.webhookPath,
      });
    },
  },
};
