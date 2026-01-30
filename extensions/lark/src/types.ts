import type { ClawdbotConfig } from "clawdbot/plugin-sdk";

// Lark configuration stored in clawdbot config file
export type LarkChannelConfig = {
  enabled?: boolean;
  appId?: string;
  appSecret?: string;
  encryptKey?: string;
  verificationToken?: string;
  // Bot's open_id for mention filtering (get from Lark developer console or event logs)
  botOpenId?: string;
  // OAuth configuration for user authorization
  oauthRedirectUri?: string; // e.g., "http://localhost:9000/oauth/callback"
  oauthScope?: string; // e.g., "docx:document:readonly wiki:wiki:readonly"
  requireUserAuth?: boolean; // If true, require user authorization for certain features
  // Webhook configuration
  webhookPort?: number;
  webhookPath?: string;
  // DM policy
  dmPolicy?: "open" | "pairing" | "allowlist";
  allowFrom?: string[];
  // Group policy
  groupPolicy?: "open" | "allowlist";
  groups?: Record<
    string,
    {
      enabled?: boolean;
      requireMention?: boolean;
      toolPolicy?: string;
    }
  >;
  // Named accounts for multi-bot setups
  accounts?: Record<string, LarkAccountConfig>;
};

export type LarkAccountConfig = {
  enabled?: boolean;
  name?: string;
  appId?: string;
  appSecret?: string;
  encryptKey?: string;
  verificationToken?: string;
  botOpenId?: string;
  // OAuth configuration
  oauthRedirectUri?: string;
  oauthScope?: string;
  requireUserAuth?: boolean;
  webhookPort?: number;
  webhookPath?: string;
  dmPolicy?: "open" | "pairing" | "allowlist";
  allowFrom?: string[];
  groupPolicy?: "open" | "allowlist";
  groups?: Record<
    string,
    {
      enabled?: boolean;
      requireMention?: boolean;
      toolPolicy?: string;
    }
  >;
};

export type ResolvedLarkAccount = {
  accountId: string;
  name?: string;
  enabled: boolean;
  appId: string;
  appSecret: string;
  encryptKey?: string;
  verificationToken?: string;
  appIdSource: "config" | "env" | "none";
  appSecretSource: "config" | "env" | "none";
  config: LarkAccountConfig;
};

// Lark event types
export type LarkMessageEvent = {
  schema: string;
  header: {
    event_id: string;
    event_type: string;
    create_time: string;
    token: string;
    app_id: string;
    tenant_key: string;
  };
  event: {
    sender: {
      sender_id: {
        union_id: string;
        user_id: string;
        open_id: string;
      };
      sender_type: string;
      tenant_key: string;
    };
    message: {
      message_id: string;
      root_id?: string;
      parent_id?: string;
      create_time: string;
      update_time?: string;
      chat_id: string;
      chat_type: "p2p" | "group";
      message_type: string;
      content: string;
      mentions?: Array<{
        key: string;
        id: {
          union_id: string;
          user_id: string;
          open_id: string;
        };
        name: string;
        tenant_key: string;
      }>;
    };
  };
};

// Extend ClawdbotConfig to include lark channel
declare module "clawdbot/plugin-sdk" {
  interface ClawdbotConfig {
    channels?: {
      lark?: LarkChannelConfig;
      [key: string]: unknown;
    };
  }
}
