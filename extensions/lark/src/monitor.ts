import * as http from "node:http";
import * as url from "node:url";
import type { ClawdbotConfig } from "clawdbot/plugin-sdk";
import type { RuntimeEnv } from "clawdbot/plugin-sdk";
import type { ResolvedLarkAccount } from "./types.js";
import { resolveLarkAccount } from "./accounts.js";
import { getLarkClient } from "./client.js";
import { getLarkRuntime } from "./runtime.js";
import {
  hasUserAuthorized,
  generateAuthUrl,
  exchangeCodeForToken,
  getValidUserToken,
  type UserToken,
} from "./oauth.js";

export type MonitorLarkOpts = {
  accountId?: string;
  config?: ClawdbotConfig;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  webhookPort?: number;
  webhookPath?: string;
};

// Pending message type - stores messages waiting for user authorization
type PendingMessage = {
  senderId: string;
  chatId: string;
  messageText: string;
  messageId: string;
  chatType: "p2p" | "group";
  senderName?: string;
  timestamp: number;
};

// Cache for pending messages (keyed by senderId)
const pendingMessagesCache = new Map<string, PendingMessage>();

// Store a pending message for later processing after auth
function storePendingMessage(msg: PendingMessage) {
  pendingMessagesCache.set(msg.senderId, msg);
  // Clean up old pending messages (older than 10 minutes)
  const now = Date.now();
  for (const [key, value] of pendingMessagesCache.entries()) {
    if (now - value.timestamp > 10 * 60 * 1000) {
      pendingMessagesCache.delete(key);
    }
  }
}

// Get and remove pending message for a user
function getPendingMessage(senderId: string): PendingMessage | undefined {
  const msg = pendingMessagesCache.get(senderId);
  if (msg) {
    pendingMessagesCache.delete(senderId);
  }
  return msg;
}

// Extract text content from Lark message
function extractMessageText(content: string, messageType: string): string {
  try {
    if (messageType === "text") {
      const parsed = JSON.parse(content);
      return parsed.text ?? "";
    }
    // Handle other message types as needed
    return content;
  } catch {
    return content;
  }
}

// Send authorization link to user
async function sendAuthLink(params: {
  account: ResolvedLarkAccount;
  chatId: string;
  senderId: string;
  webhookPort: number;
  log: (...args: any[]) => void;
}) {
  const { account, chatId, senderId, webhookPort, log } = params;
  
  // Build redirect URI
  const redirectUri = account.config.oauthRedirectUri || 
    `http://localhost:${webhookPort}/oauth/callback`;
  
  // Default scopes for document access
  const scope = account.config.oauthScope || 
    "docx:document:readonly wiki:wiki:readonly drive:drive:readonly";
  
  // Generate auth URL with state containing senderId for tracking
  const authUrl = generateAuthUrl({
    appId: account.appId,
    redirectUri,
    state: senderId,
    scope,
  });
  
  log(`[lark:${account.accountId}] Sending auth link to ${senderId}`);
  
  // Send message with authorization link
  const client = getLarkClient(account);
  await client.im.message.create({
    params: {
      receive_id_type: "chat_id",
    },
    data: {
      receive_id: chatId,
      msg_type: "interactive",
      content: JSON.stringify({
        config: {
          wide_screen_mode: true,
        },
        header: {
          title: {
            tag: "plain_text",
            content: "🔐 需要授权",
          },
        },
        elements: [
          {
            tag: "div",
            text: {
              tag: "lark_md",
              content: "要使用文档相关功能，需要你先授权机器人访问你的文档。\n\n点击下方按钮完成授权（只需一次）：",
            },
          },
          {
            tag: "action",
            actions: [
              {
                tag: "button",
                text: {
                  tag: "plain_text",
                  content: "点击授权",
                },
                type: "primary",
                url: authUrl,
              },
            ],
          },
        ],
      }),
    },
  });
}

// Handle incoming Lark event
async function handleLarkEvent(params: {
  data: any;
  account: ResolvedLarkAccount;
  config: ClawdbotConfig;
  runtime?: RuntimeEnv;
  webhookPort?: number;
  skipMentionCheck?: boolean; // Skip mention check for pending message reprocessing
}) {
  const { data, account, config, runtime, webhookPort = 9000, skipMentionCheck = false } = params;
  const log = runtime?.log ?? console.log;
  const error = runtime?.error ?? console.error;

  // Get event type from header or schema
  const eventType = data.header?.event_type ?? data.event?.type;
  
  if (eventType !== "im.message.receive_v1") {
    log(`[lark:${account.accountId}] Ignoring event type: ${eventType}`);
    return;
  }

  const event = data.event;
  if (!event) {
    log(`[lark:${account.accountId}] No event data`);
    return;
  }

  const message = event.message;
  const sender = event.sender;

  if (!message || !sender) {
    log(`[lark:${account.accountId}] Missing message or sender`);
    return;
  }

  const messageText = extractMessageText(message.content, message.message_type);
  const chatId = message.chat_id;
  const chatType = message.chat_type;
  const senderId = sender.sender_id?.open_id ?? sender.sender_id?.user_id ?? "unknown";
  const senderUnionId = sender.sender_id?.union_id;
  const messageId = message.message_id;
  const isGroup = chatType !== "p2p";

  // Try to get sender's name from Lark API (requires contact:user.base:readonly permission)
  let senderName: string | undefined;
  try {
    const client = getLarkClient(account);
    const userInfo = await client.contact.v3.user.get({
      path: { user_id: senderId },
      params: { user_id_type: "open_id" },
    });
    senderName = userInfo.data?.user?.name;
  } catch {
    // Silently ignore - app may not have user info permission
    // Sender name is optional, we'll just use open_id
  }

  // Build sender info string for logging and context
  const senderInfo = senderName 
    ? `${senderName} (${senderId})`
    : senderId;

  // Get bot's open_id from cache
  const botOpenId = botOpenIdCache.get(account.accountId);

  // Check if bot was mentioned in the message
  // Only respond if THIS bot is @mentioned, not just any @mention
  const mentions = message.mentions ?? [];
  const isBotMentioned = botOpenId 
    ? mentions.some((m: any) => m.id?.open_id === botOpenId)
    : false; // If we don't have bot info cached, don't respond to avoid responding to other bots' mentions
  
  // Only log mention details if there are mentions
  if (mentions.length > 0) {
    log(`[lark:${account.accountId}] Mentions: ${mentions.map((m: any) => m.name).join(", ")}, isBotMentioned: ${isBotMentioned}`);
  }

  // For group chats, only respond when bot is @mentioned (unless skipMentionCheck is true)
  if (isGroup && !isBotMentioned && !skipMentionCheck) {
    log(`[lark:${account.accountId}] Ignoring group message (bot not mentioned)`);
    return;
  }

  // Build session key for this conversation
  const sessionKey = `lark:${chatId}`;

  // Log inbound message
  log(`[lark:${account.accountId}] Received message from ${senderInfo} in ${chatType}: ${messageText.slice(0, 50)}...`);

  // Record channel activity
  try {
    getLarkRuntime().channel.activity.record({
      channel: "lark",
      accountId: account.accountId,
      direction: "inbound",
    });
  } catch (err) {
    // Ignore activity recording errors
  }

  // Resolve agent route for session management
  const route = getLarkRuntime().channel.routing.resolveAgentRoute({
    cfg: config,
    channel: "lark",
    accountId: account.accountId,
  });
  const agentId = route.agentId;
  
  // Use a single shared session for all Lark chats (groups and DMs)
  const finalSessionKey = route.mainSessionKey;

  // Check if user has authorized (for document access features)
  const userAuthorized = hasUserAuthorized(senderId);
  let userToken: UserToken | null = null;
  
  if (userAuthorized) {
    userToken = await getValidUserToken({ account, openId: senderId });
  }
  
  // Check if message requires document access (simple keyword check)
  const needsDocAccess = /文档|授权|document|doc|wiki|知识库|云文档|飞书文档/i.test(messageText);
  
  // If needs doc access but not authorized, send auth link and store pending message
  if (needsDocAccess && !userToken && account.config.requireUserAuth !== false) {
    log(`[lark:${account.accountId}] User ${senderId} needs authorization for document access`);
    try {
      // Store the message for processing after authorization
      const pendingMsg = {
        senderId,
        chatId,
        messageText,
        messageId,
        chatType: chatType as "p2p" | "group",
        senderName,
        timestamp: Date.now(),
      };
      storePendingMessage(pendingMsg);
      log(`[lark:${account.accountId}] Stored pending message for senderId: ${senderId}, messageId: ${messageId}`);
      
      await sendAuthLink({
        account,
        chatId,
        senderId,
        webhookPort,
        log,
      });
      return; // Don't process the message further until user authorizes
    } catch (authErr) {
      error(`[lark:${account.accountId}] Failed to send auth link: ${authErr}`);
      // Continue processing without user token
    }
  }

  // Build the inbound context for clawdbot
  // Include sender info (name and open_id) so the agent knows who sent the message
  const bodyWithSource = isGroup
    ? `[From: ${senderInfo} in lark group: ${chatId}]\n${messageText}`
    : `[From: ${senderInfo}]\n${messageText}`;
  
  const inboundCtx = {
    Body: bodyWithSource,
    RawBody: messageText,
    From: `lark:${senderId}`,
    FromName: senderName,
    FromOpenId: senderId,
    To: `lark:${chatId}`,
    SessionKey: finalSessionKey,
    AccountId: account.accountId,
    ChatType: isGroup ? "group" : "direct",
    Surface: "lark",
    Provider: "lark",
    MessageSid: messageId,
    IsMentioned: isBotMentioned,
    UserAuthorized: userAuthorized,
    UserAccessToken: userToken?.accessToken,
    OriginatingChannel: "lark" as const,
    OriginatingTo: `lark:${chatId}`,
  };

  // Try to dispatch through clawdbot's reply system
  try {
    const finalizedCtx = getLarkRuntime().channel.reply.finalizeInboundContext(inboundCtx);
    
    // Record session for chat history
    try {
      const storePath = getLarkRuntime().channel.session.resolveStorePath(config.session?.store, { agentId });
      await getLarkRuntime().channel.session.recordInboundSession({
        storePath,
        sessionKey: finalizedCtx.SessionKey ?? finalSessionKey,
        ctx: finalizedCtx,
        createIfMissing: true,
        // Always update last route so replies go to the most recent chat
        updateLastRoute: {
          sessionKey: route.mainSessionKey,
          channel: "lark",
          to: chatId,
          accountId: account.accountId,
        },
        onRecordError: (err) => {
          log(`[lark:${account.accountId}] Session record error: ${err}`);
        },
      });
    } catch (sessionErr) {
      log(`[lark:${account.accountId}] Failed to record session: ${sessionErr}`);
    }
    
    // Create a simple dispatcher that sends replies back to Lark
    const client = getLarkClient(account);
    
    const sendReply = async (text: string) => {
      await client.im.message.create({
        params: {
          receive_id_type: "chat_id",
        },
        data: {
          receive_id: chatId,
          msg_type: "text",
          content: JSON.stringify({ text }),
        },
      });
      log(`[lark:${account.accountId}] Sent reply to ${chatId}`);
      
      // Record outbound activity
      getLarkRuntime().channel.activity.record({
        channel: "lark",
        accountId: account.accountId,
        direction: "outbound",
      });
    };

    // Use dispatchReplyWithBufferedBlockDispatcher for AI reply
    const result = await getLarkRuntime().channel.reply.dispatchReplyWithBufferedBlockDispatcher({
      ctx: finalizedCtx,
      cfg: config,
      dispatcherOptions: {
        deliver: async (payload: any, info: any) => {
          if (payload.text) {
            await sendReply(payload.text);
          }
        },
        onError: (err: any, info: any) => {
          error(`[lark:${account.accountId}] Reply error: ${err}`);
        },
      },
    });

    if (!result.queuedFinal) {
      log(`[lark:${account.accountId}] No response generated`);
    }
  } catch (err) {
    error(`[lark:${account.accountId}] Failed to dispatch reply: ${err}`);
    
    // Fallback: send simple echo reply
    try {
      const client = getLarkClient(account);
      await client.im.message.create({
        params: {
          receive_id_type: "chat_id",
        },
        data: {
          receive_id: chatId,
          msg_type: "text",
          content: JSON.stringify({ text: `收到: ${messageText.slice(0, 100)}` }),
        },
      });
    } catch (fallbackErr) {
      error(`[lark:${account.accountId}] Fallback reply also failed: ${fallbackErr}`);
    }
  }
}

// Cache for bot open_id per account
const botOpenIdCache = new Map<string, string>();

// Start webhook server to receive Lark events
export async function monitorLarkProvider(opts: MonitorLarkOpts = {}) {
  const cfg = opts.config ?? getLarkRuntime().config.loadConfig();
  const account = resolveLarkAccount({
    cfg,
    accountId: opts.accountId,
  });

  if (!account.appId || !account.appSecret) {
    throw new Error(
      `Lark credentials missing for account "${account.accountId}" (set channels.lark.appId/appSecret or LARK_APP_ID/LARK_APP_SECRET).`,
    );
  }

  const port = opts.webhookPort ?? account.config.webhookPort ?? 9000;
  const webhookPath = opts.webhookPath ?? account.config.webhookPath ?? "/webhook";

  const log = opts.runtime?.log ?? console.log;
  const error = opts.runtime?.error ?? console.error;

  // Get bot's open_id from config or environment
  const botOpenId = account.config.botOpenId?.trim() || process.env.LARK_BOT_OPEN_ID?.trim();
  if (botOpenId) {
    botOpenIdCache.set(account.accountId, botOpenId);
    log(`[lark:${account.accountId}] Bot open_id from config: ${botOpenId}`);
  } else {
    log(`[lark:${account.accountId}] Warning: No botOpenId configured. Bot will not respond to @mentions in groups.`);
    log(`[lark:${account.accountId}] Set channels.lark.botOpenId in config or LARK_BOT_OPEN_ID env var.`);
  }

  // Helper to check if URL matches webhook path
  const matchesWebhookPath = (url: string | undefined): boolean => {
    if (!url) return false;
    const urlPath = url.split("?")[0]; // Remove query string
    return urlPath === webhookPath || urlPath === webhookPath + "/";
  };

  // Create HTTP server
  const server = http.createServer(async (req, res) => {
    // Health check endpoint
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", channel: "lark", accountId: account.accountId }));
      return;
    }

    // Handle webhook POST requests
    if (req.method === "POST" && matchesWebhookPath(req.url)) {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk.toString();
      });

      req.on("end", async () => {
        try {
          const data = JSON.parse(body);
          log(`[lark:${account.accountId}] Received webhook: ${JSON.stringify(data).slice(0, 200)}...`);

          // Handle URL verification challenge from Lark
          if (data.type === "url_verification") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ challenge: data.challenge }));
            log(`[lark:${account.accountId}] URL verification completed`);
            return;
          }

          // Handle event callback (v2 schema)
          if (data.schema === "2.0" || data.header) {
            // Process event asynchronously
            handleLarkEvent({
              data,
              account,
              config: cfg,
              runtime: opts.runtime as RuntimeEnv,
              webhookPort: port,
            }).catch((err) => {
              error(`[lark:${account.accountId}] Event handler error: ${err}`);
            });

            // Respond immediately to Lark
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true }));
            return;
          }

          // Handle event callback (v1 schema)
          if (data.event) {
            handleLarkEvent({
              data,
              account,
              config: cfg,
              runtime: opts.runtime as RuntimeEnv,
              webhookPort: port,
            }).catch((err) => {
              error(`[lark:${account.accountId}] Event handler error: ${err}`);
            });

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: true }));
            return;
          }

          // Unknown request type
          log(`[lark:${account.accountId}] Unknown webhook data: ${JSON.stringify(data).slice(0, 100)}`);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        } catch (err) {
          error(`[lark:${account.accountId}] Webhook error: ${err}`);
          if (!res.headersSent) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Internal server error" }));
          }
        }
      });
      return;
    }

    // OAuth callback endpoint
    if (req.method === "GET" && req.url?.startsWith("/oauth/callback")) {
      try {
        const parsedUrl = url.parse(req.url, true);
        const code = parsedUrl.query.code as string;
        const state = parsedUrl.query.state as string;
        
        if (!code) {
          res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<h1>授权失败</h1><p>缺少授权码</p>");
          return;
        }
        
        log(`[lark:${account.accountId}] OAuth callback received, code: ${code.slice(0, 10)}...`);
        
        // Get the redirect_uri that was used for this OAuth flow
        const redirectUri = account.config.oauthRedirectUri || 
          `http://localhost:${port}/oauth/callback`;
        
        // Exchange code for token
        const token = await exchangeCodeForToken({ account, code, redirectUri });
        
        log(`[lark:${account.accountId}] User authorized: ${token.openId}`);
        
        // Check for pending message from this user
        log(`[lark:${account.accountId}] Looking for pending message with key: ${token.openId}`);
        log(`[lark:${account.accountId}] Current pending messages: ${JSON.stringify([...pendingMessagesCache.keys()])}`);
        
        const pendingMsg = getPendingMessage(token.openId);
        
        if (pendingMsg) {
          log(`[lark:${account.accountId}] Found pending message: ${JSON.stringify(pendingMsg)}`);
          log(`[lark:${account.accountId}] Processing pending message for ${token.openId}`);
          
          // Process the pending message with the new user token
          // Build a fake event data structure to reprocess the message
          const fakeEventData = {
            schema: "2.0",
            header: { event_type: "im.message.receive_v1" },
            event: {
              sender: {
                sender_id: { open_id: pendingMsg.senderId },
              },
              message: {
                message_id: pendingMsg.messageId,
                chat_id: pendingMsg.chatId,
                chat_type: pendingMsg.chatType,
                message_type: "text",
                content: JSON.stringify({ text: pendingMsg.messageText }),
                mentions: [], // User already authorized, no need for mention check bypass
              },
            },
          };
          
          // Process asynchronously so we can respond to the OAuth callback immediately
          handleLarkEvent({
            data: fakeEventData,
            account,
            config: cfg,
            runtime: opts.runtime as RuntimeEnv,
            webhookPort: port,
            skipMentionCheck: true, // Skip mention check for pending messages
          }).catch((err) => {
            error(`[lark:${account.accountId}] Failed to process pending message: ${err}`);
          });
          
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`
            <html>
            <head><title>授权成功</title></head>
            <body style="font-family: sans-serif; text-align: center; padding: 50px;">
              <h1>✅ 授权成功！</h1>
              <p>你的 Lark 账号已成功授权给机器人。</p>
              <p>正在处理你之前的消息，请回到 Lark 查看回复。</p>
            </body>
            </html>
          `);
        } else {
          log(`[lark:${account.accountId}] No pending message found for ${token.openId}`);
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(`
            <html>
            <head><title>授权成功</title></head>
            <body style="font-family: sans-serif; text-align: center; padding: 50px;">
              <h1>✅ 授权成功！</h1>
              <p>你的 Lark 账号已成功授权给机器人。</p>
              <p>现在可以关闭此页面，回到 Lark 继续使用。</p>
            </body>
            </html>
          `);
        }
      } catch (err) {
        error(`[lark:${account.accountId}] OAuth callback error: ${err}`);
        res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`
          <html>
          <head><title>授权失败</title></head>
          <body style="font-family: sans-serif; text-align: center; padding: 50px;">
            <h1>❌ 授权失败</h1>
            <p>错误: ${err}</p>
            <p>请重试或联系管理员。</p>
          </body>
          </html>
        `);
      }
      return;
    }

    // 404 for other requests
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  });

  // Handle abort signal
  if (opts.abortSignal) {
    opts.abortSignal.addEventListener(
      "abort",
      () => {
        log(`[lark:${account.accountId}] Stopping webhook server`);
        server.close();
      },
      { once: true },
    );
  }

  // Start server
  return new Promise<void>((resolve, reject) => {
    server.on("error", (err) => {
      error(`[lark:${account.accountId}] Server error: ${err}`);
      reject(err);
    });

    server.listen(port, () => {
      log(`[lark:${account.accountId}] Webhook server listening on port ${port} at ${webhookPath}`);
      resolve();
    });
  });
}
