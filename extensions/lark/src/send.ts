import type { ClawdbotConfig } from "clawdbot/plugin-sdk";
import { resolveLarkAccount } from "./accounts.js";
import { getLarkClient, sendLarkMessage, uploadLarkImage, sendLarkImage } from "./client.js";
import { getLarkRuntime } from "./runtime.js";

export type LarkSendOpts = {
  accountId?: string;
  mediaUrl?: string;
  replyToId?: string;
};

export type LarkSendResult = {
  messageId: string;
  chatId: string;
};

// Normalize chat ID - handle various input formats
function normalizeChatId(to: string): string {
  const trimmed = to.trim();
  if (!trimmed) throw new Error("Recipient is required for Lark sends");

  // Strip common prefixes
  let normalized = trimmed
    .replace(/^lark:/i, "")
    .replace(/^feishu:/i, "")
    .trim();

  if (!normalized) throw new Error("Recipient is required for Lark sends");
  return normalized;
}

// Send message to Lark
export async function sendMessageLark(
  to: string,
  text: string,
  opts: LarkSendOpts = {},
): Promise<LarkSendResult> {
  const cfg = getLarkRuntime().config.loadConfig();
  const account = resolveLarkAccount({
    cfg,
    accountId: opts.accountId,
  });

  if (!account.appId || !account.appSecret) {
    throw new Error(
      `Lark credentials missing for account "${account.accountId}" (set channels.lark.appId/appSecret or LARK_APP_ID/LARK_APP_SECRET).`,
    );
  }

  const chatId = normalizeChatId(to);
  const client = getLarkClient(account);

  // Handle media if provided
  if (opts.mediaUrl) {
    try {
      const media = await getLarkRuntime().media.loadWebMedia(opts.mediaUrl);
      const mime = media.contentType?.toLowerCase() ?? "";

      // Upload and send image if it's an image type
      if (mime.startsWith("image/")) {
        const imageKey = await uploadLarkImage({
          client,
          image: media.buffer,
        });

        // If there's text, send image first then text
        const imageResult = await sendLarkImage({
          client,
          chatId,
          imageKey,
        });

        if (text?.trim()) {
          const textResult = await sendLarkMessage({
            client,
            chatId,
            content: text,
          });
          return textResult;
        }

        return imageResult;
      }
      // For non-image media, include URL in text
      const textWithMedia = `${text}\n\n📎 ${opts.mediaUrl}`;
      return await sendLarkMessage({
        client,
        chatId,
        content: textWithMedia,
      });
    } catch (err) {
      // Fallback to text with media link on error
      console.warn(`Lark media upload failed, falling back to link: ${err}`);
      const textWithMedia = `${text}\n\n📎 ${opts.mediaUrl}`;
      return await sendLarkMessage({
        client,
        chatId,
        content: textWithMedia,
      });
    }
  }

  // Send text message
  if (!text?.trim()) {
    throw new Error("Message must be non-empty for Lark sends");
  }

  return await sendLarkMessage({
    client,
    chatId,
    content: text,
  });
}

// Probe Lark connection
export async function probeLark(
  appId: string,
  appSecret: string,
  timeoutMs = 5000,
): Promise<{ ok: boolean; bot?: { appName: string; openId: string }; error?: string }> {
  try {
    const client = getLarkClient({
      accountId: "probe",
      name: "probe",
      enabled: true,
      appId,
      appSecret,
      appIdSource: "config",
      appSecretSource: "config",
      config: { appId, appSecret },
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await client.bot.botInfo.get({});

      if (response.code !== 0) {
        return { ok: false, error: response.msg };
      }

      return {
        ok: true,
        bot: {
          appName: response.data?.bot?.bot_name ?? "unknown",
          openId: response.data?.bot?.open_id ?? "",
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
