import * as fs from "node:fs";
import * as path from "node:path";
import type { ResolvedLarkAccount } from "./types.js";

// Token storage directory
const TOKEN_STORAGE_DIR = process.env.LARK_TOKEN_DIR || path.join(process.env.HOME || "/tmp", ".clawdbot", "lark-tokens");

// Ensure token directory exists
function ensureTokenDir() {
  if (!fs.existsSync(TOKEN_STORAGE_DIR)) {
    fs.mkdirSync(TOKEN_STORAGE_DIR, { recursive: true });
  }
}

// Token data structure
export type UserToken = {
  openId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp in ms
  refreshExpiresAt: number; // Unix timestamp in ms
  createdAt: number;
  updatedAt: number;
};

// Get token file path for a user
function getTokenPath(openId: string): string {
  ensureTokenDir();
  // Sanitize openId for filename
  const safeId = openId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(TOKEN_STORAGE_DIR, `${safeId}.json`);
}

// Load user token from storage
export function loadUserToken(openId: string): UserToken | null {
  const tokenPath = getTokenPath(openId);
  try {
    if (fs.existsSync(tokenPath)) {
      const data = fs.readFileSync(tokenPath, "utf-8");
      return JSON.parse(data) as UserToken;
    }
  } catch (err) {
    console.error(`[lark-oauth] Failed to load token for ${openId}:`, err);
  }
  return null;
}

// Save user token to storage
export function saveUserToken(token: UserToken): void {
  const tokenPath = getTokenPath(token.openId);
  try {
    ensureTokenDir();
    fs.writeFileSync(tokenPath, JSON.stringify(token, null, 2));
  } catch (err) {
    console.error(`[lark-oauth] Failed to save token for ${token.openId}:`, err);
  }
}

// Delete user token
export function deleteUserToken(openId: string): void {
  const tokenPath = getTokenPath(openId);
  try {
    if (fs.existsSync(tokenPath)) {
      fs.unlinkSync(tokenPath);
    }
  } catch (err) {
    console.error(`[lark-oauth] Failed to delete token for ${openId}:`, err);
  }
}

// Check if token is expired (with 5 minute buffer)
export function isTokenExpired(token: UserToken): boolean {
  return Date.now() > token.expiresAt - 5 * 60 * 1000;
}

// Check if refresh token is expired
export function isRefreshTokenExpired(token: UserToken): boolean {
  return Date.now() > token.refreshExpiresAt;
}

// API base URL - use Lark (International) or Feishu (China)
// Set LARK_API_BASE=https://open.feishu.cn for China version
const API_BASE = process.env.LARK_API_BASE || "https://open.larksuite.com";

// Generate OAuth authorization URL
export function generateAuthUrl(params: {
  appId: string;
  redirectUri: string;
  state?: string;
  scope?: string;
}): string {
  const { appId, redirectUri, state, scope } = params;
  const baseUrl = `${API_BASE}/open-apis/authen/v1/authorize`;
  
  const queryParams = new URLSearchParams({
    app_id: appId,
    redirect_uri: redirectUri,
    response_type: "code",
  });
  
  if (state) {
    queryParams.set("state", state);
  }
  
  if (scope) {
    queryParams.set("scope", scope);
  }
  
  return `${baseUrl}?${queryParams.toString()}`;
}

// Get app_access_token for API calls
async function getAppAccessToken(appId: string, appSecret: string): Promise<string> {
  const response = await fetch(`${API_BASE}/open-apis/auth/v3/app_access_token/internal`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      app_id: appId,
      app_secret: appSecret,
    }),
  });
  
  const data = await response.json();
  if (data.code !== 0 || !data.app_access_token) {
    throw new Error(`Failed to get app_access_token: ${data.msg} (code: ${data.code})`);
  }
  
  return data.app_access_token;
}

// Exchange authorization code for tokens
export async function exchangeCodeForToken(params: {
  account: ResolvedLarkAccount;
  code: string;
  redirectUri?: string;
}): Promise<UserToken> {
  const { account, code, redirectUri } = params;
  
  // Step 1: Get app_access_token
  const appAccessToken = await getAppAccessToken(account.appId, account.appSecret);
  console.log("[lark-oauth] Got app_access_token");
  
  // Step 2: Exchange code for user_access_token using app_access_token
  const tokenResponse = await fetch(`${API_BASE}/open-apis/authen/v1/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${appAccessToken}`,
    },
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
    }),
  });
  
  const tokenData = await tokenResponse.json();
  console.log("[lark-oauth] Token response:", JSON.stringify(tokenData, null, 2));
  
  if (tokenData.code !== 0 || !tokenData.data) {
    throw new Error(`Failed to exchange code: ${tokenData.msg} (code: ${tokenData.code})`);
  }
  
  const data = tokenData.data;
  const now = Date.now();
  
  // Get user info using the user access token
  const userInfoResponse = await fetch(`${API_BASE}/open-apis/authen/v1/user_info`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${data.access_token}`,
    },
  });
  
  const userInfoData = await userInfoResponse.json();
  
  if (userInfoData.code !== 0 || !userInfoData.data) {
    throw new Error(`Failed to get user info: ${userInfoData.msg}`);
  }
  
  const openId = userInfoData.data.open_id;
  if (!openId) {
    throw new Error("No open_id in user info response");
  }
  
  const token: UserToken = {
    openId,
    accessToken: data.access_token!,
    refreshToken: data.refresh_token!,
    expiresAt: now + (data.expires_in ?? 7200) * 1000,
    refreshExpiresAt: now + (data.refresh_expires_in ?? 30 * 24 * 3600) * 1000,
    createdAt: now,
    updatedAt: now,
  };
  
  saveUserToken(token);
  return token;
}

// Refresh user access token
export async function refreshUserToken(params: {
  account: ResolvedLarkAccount;
  token: UserToken;
}): Promise<UserToken> {
  const { account, token } = params;
  
  if (isRefreshTokenExpired(token)) {
    deleteUserToken(token.openId);
    throw new Error("Refresh token expired, user needs to re-authorize");
  }
  
  // Get app_access_token first
  const appAccessToken = await getAppAccessToken(account.appId, account.appSecret);
  
  // Use app_access_token to refresh user token
  const response = await fetch(`${API_BASE}/open-apis/authen/v1/refresh_access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${appAccessToken}`,
    },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: token.refreshToken,
    }),
  });
  
  const responseData = await response.json();
  
  if (responseData.code !== 0 || !responseData.data) {
    throw new Error(`Failed to refresh token: ${responseData.msg} (code: ${responseData.code})`);
  }
  
  const data = responseData.data;
  const now = Date.now();
  
  const newToken: UserToken = {
    ...token,
    accessToken: data.access_token!,
    refreshToken: data.refresh_token!,
    expiresAt: now + (data.expires_in ?? 7200) * 1000,
    refreshExpiresAt: now + (data.refresh_expires_in ?? 30 * 24 * 3600) * 1000,
    updatedAt: now,
  };
  
  saveUserToken(newToken);
  return newToken;
}

// Get valid user access token (refresh if needed)
export async function getValidUserToken(params: {
  account: ResolvedLarkAccount;
  openId: string;
}): Promise<UserToken | null> {
  const { account, openId } = params;
  
  const token = loadUserToken(openId);
  if (!token) {
    return null;
  }
  
  if (isRefreshTokenExpired(token)) {
    deleteUserToken(openId);
    return null;
  }
  
  if (isTokenExpired(token)) {
    try {
      return await refreshUserToken({ account, token });
    } catch (err) {
      console.error(`[lark-oauth] Failed to refresh token for ${openId}:`, err);
      deleteUserToken(openId);
      return null;
    }
  }
  
  return token;
}

// Check if user has authorized
export function hasUserAuthorized(openId: string): boolean {
  const token = loadUserToken(openId);
  if (!token) return false;
  if (isRefreshTokenExpired(token)) {
    deleteUserToken(openId);
    return false;
  }
  return true;
}

// List all authorized users
export function listAuthorizedUsers(): string[] {
  ensureTokenDir();
  try {
    const files = fs.readdirSync(TOKEN_STORAGE_DIR);
    return files
      .filter(f => f.endsWith(".json"))
      .map(f => {
        try {
          const data = fs.readFileSync(path.join(TOKEN_STORAGE_DIR, f), "utf-8");
          const token = JSON.parse(data) as UserToken;
          return token.openId;
        } catch {
          return null;
        }
      })
      .filter((id): id is string => id !== null);
  } catch {
    return [];
  }
}
