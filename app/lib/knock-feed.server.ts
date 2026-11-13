import { signUserToken } from "@knocklabs/node";
import type { KnockFeedConfig } from "~/lib/notifications";

// ─── Knock feed auth ───
// Enhanced security is on: the browser needs a user token signed by Cadence
// (RS256, KNOCK_SIGNING_KEY, sub = user id) to read its own feed.
//
// Tokens are cached per user and reused until 10 minutes before their 1 h
// expiry. A new token on every loader revalidation makes KnockProvider rebuild
// its client and drop the live connection.

const TOKEN_TTL_SECONDS = 60 * 60;
const REFRESH_BEFORE_EXPIRY_MS = 10 * 60 * 1000;

const tokens = new Map<string, { token: string; expiresAt: number }>();

async function userToken(userId: string, signingKey: string): Promise<string> {
  const cached = tokens.get(userId);
  if (cached && cached.expiresAt - Date.now() > REFRESH_BEFORE_EXPIRY_MS) {
    return cached.token;
  }
  const token = await signUserToken(userId, {
    signingKey,
    expiresInSeconds: TOKEN_TTL_SECONDS,
  });
  tokens.set(userId, {
    token,
    expiresAt: Date.now() + TOKEN_TTL_SECONDS * 1000,
  });
  return token;
}

/**
 * The client's Knock feed config for a signed-in user, or null when Knock keys
 * are missing (the UI then shows an empty feed) or signing fails.
 */
export async function getKnockFeedConfig(
  userId: number
): Promise<KnockFeedConfig | null> {
  const publicKey = process.env.KNOCK_PUBLIC_KEY;
  const feedChannelId = process.env.KNOCK_FEED_CHANNEL_ID;
  const signingKey = process.env.KNOCK_SIGNING_KEY;
  if (!publicKey || !feedChannelId || !signingKey) return null;

  try {
    return {
      publicKey,
      feedChannelId,
      userId: String(userId),
      userToken: await userToken(String(userId), signingKey),
    };
  } catch (error) {
    console.error(`[knock] signing a user token for ${userId} failed:`, error);
    return null;
  }
}
