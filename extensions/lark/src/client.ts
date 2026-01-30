import * as lark from "@larksuiteoapi/node-sdk";
import type { ResolvedLarkAccount } from "./types.js";

// Cache for Lark clients
const clientCache = new Map<string, lark.Client>();

// Create or get cached Lark client
export function getLarkClient(account: ResolvedLarkAccount): lark.Client {
  const cacheKey = `${account.appId}:${account.appSecret}`;

  let client = clientCache.get(cacheKey);
  if (!client) {
    client = new lark.Client({
      appId: account.appId,
      appSecret: account.appSecret,
      disableTokenCache: false,
    });
    clientCache.set(cacheKey, client);
  }

  return client;
}

// Clear client cache (useful for testing or credential rotation)
export function clearLarkClientCache(): void {
  clientCache.clear();
}

// Send text message to a chat
export async function sendLarkMessage(params: {
  client: lark.Client;
  chatId: string;
  content: string;
  msgType?: "text" | "post" | "interactive";
}): Promise<{ messageId: string; chatId: string }> {
  const { client, chatId, content, msgType = "text" } = params;

  // Prepare content based on message type
  let formattedContent: string;
  if (msgType === "text") {
    formattedContent = JSON.stringify({ text: content });
  } else {
    formattedContent = content;
  }

  const response = await client.im.message.create({
    params: {
      receive_id_type: "chat_id",
    },
    data: {
      receive_id: chatId,
      msg_type: msgType,
      content: formattedContent,
    },
  });

  if (response.code !== 0) {
    throw new Error(`Lark API error: ${response.msg} (code: ${response.code})`);
  }

  return {
    messageId: response.data?.message_id ?? "unknown",
    chatId,
  };
}

// Reply to a message in a thread
export async function replyLarkMessage(params: {
  client: lark.Client;
  messageId: string;
  content: string;
  msgType?: "text" | "post" | "interactive";
}): Promise<{ messageId: string }> {
  const { client, messageId, content, msgType = "text" } = params;

  let formattedContent: string;
  if (msgType === "text") {
    formattedContent = JSON.stringify({ text: content });
  } else {
    formattedContent = content;
  }

  const response = await client.im.message.reply({
    path: {
      message_id: messageId,
    },
    data: {
      msg_type: msgType,
      content: formattedContent,
    },
  });

  if (response.code !== 0) {
    throw new Error(`Lark API error: ${response.msg} (code: ${response.code})`);
  }

  return {
    messageId: response.data?.message_id ?? "unknown",
  };
}

// Send image message
export async function sendLarkImage(params: {
  client: lark.Client;
  chatId: string;
  imageKey: string;
}): Promise<{ messageId: string; chatId: string }> {
  const { client, chatId, imageKey } = params;

  const content = JSON.stringify({ image_key: imageKey });

  const response = await client.im.message.create({
    params: {
      receive_id_type: "chat_id",
    },
    data: {
      receive_id: chatId,
      msg_type: "image",
      content,
    },
  });

  if (response.code !== 0) {
    throw new Error(`Lark API error: ${response.msg} (code: ${response.code})`);
  }

  return {
    messageId: response.data?.message_id ?? "unknown",
    chatId,
  };
}

// Upload image to Lark
export async function uploadLarkImage(params: {
  client: lark.Client;
  image: Buffer;
  imageType?: "message" | "avatar";
}): Promise<string> {
  const { client, image, imageType = "message" } = params;

  const response = await client.im.image.create({
    data: {
      image_type: imageType,
      image: Buffer.from(image),
    },
  });

  if (response.code !== 0) {
    throw new Error(`Lark image upload error: ${response.msg} (code: ${response.code})`);
  }

  return response.data?.image_key ?? "";
}

// Get bot info
export async function getLarkBotInfo(client: lark.Client): Promise<{
  appName: string;
  openId: string;
}> {
  const response = await client.bot.botInfo.get({});

  if (response.code !== 0) {
    throw new Error(`Lark API error: ${response.msg} (code: ${response.code})`);
  }

  return {
    appName: response.data?.bot?.bot_name ?? "unknown",
    openId: response.data?.bot?.open_id ?? "",
  };
}
