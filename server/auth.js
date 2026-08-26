// Shared auth logic — used by both the local Express server and the
// Vercel serverless functions, same pattern as twilioCore.js/db.js.
// Sessions are a signed, HttpOnly cookie holding a JWT (no server-side
// session store needed). Users are invite-only: an admin seeds a row
// in `users` with an email and no password, and that person claims
// the account once via "set password" — nobody can self-register with
// an arbitrary email.
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { findApiKeyByHash, touchApiKeyLastUsed, getUserById } from "./db.js";

// ---------- Roles ----------
// owner        — henryfortunatow@gmail.com only (see db.js's
//                self-healing UPDATE in ensureSchema). All tabs, all
//                lead data, can't be edited or deleted by anyone.
// super_admin  — all tabs, all lead data, can edit other users
//                (except the owner) and can't delete the owner.
// admin        — all tabs, all lead data, can't edit or delete anyone.
// client       — only Conversation/Contacts/Reports, and only leads
//                whose tag is in that user's allowedTags.
export const ROLES = ["owner", "super_admin", "admin", "client"];
const FULL_ACCESS_TABS = ["conversation", "contacts", "powerdialler", "log", "clients", "reports", "settings"];
const CLIENT_TABS = ["conversation", "contacts", "reports"];

export function tabsForRole(role) {
  return role === "client" ? CLIENT_TABS : FULL_ACCESS_TABS;
}

export function isDataScoped(role) {
  return role === "client";
}

// Everyone but a client role sees every lead; a client role is scoped
// to their own allowedTags. Returns null for "no filter" (full
// access) so callers can pass it straight through to a query.
export function scopeTagsForUser(user) {
  return isDataScoped(user.role) ? user.allowedTags || [] : null;
}

export function canManageUsers(role) {
  return role === "owner" || role === "super_admin";
}

export function canDeleteUser(actingRole, targetRole) {
  if (targetRole === "owner") return false;
  return canManageUsers(actingRole);
}

// For endpoints a client role has no business reaching at all (client
// org management, dial lists, bulk/reset imports, column schema
// changes) — not just data they can't see, but capability they don't
// have, regardless of tag scoping. Writes the 403 itself; callers do
// `if (forbidClientRole(user, res)) return;` right after requireAuth.
export function forbidClientRole(user, res) {
  if (user.role !== "client") return false;
  res.status(403).json({ error: "Not available on this account." });
  return true;
}

export const COOKIE_NAME = "scalbl_session";
const SESSION_DAYS = 30;

// Hand-rolled instead of pulling in the `cookie` package — we only
// ever need to set/read one cookie with a fixed, small set of
// attributes, and it keeps us off that package's churny export API.
function serializeCookie(name, value, { httpOnly, secure, sameSite, path, maxAge }) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (path) parts.push(`Path=${path}`);
  if (typeof maxAge === "number") parts.push(`Max-Age=${maxAge}`);
  if (sameSite) parts.push(`SameSite=${sameSite[0].toUpperCase()}${sameSite.slice(1)}`);
  if (httpOnly) parts.push("HttpOnly");
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function parseCookieHeader(header) {
  const out = {};
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      out[key] = part.slice(eq + 1).trim();
    }
  }
  return out;
}

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) {
    throw new Error("SESSION_SECRET is not set. Add one (any long random string) to your environment variables.");
  }
  return s;
}

export function isProdHost() {
  // Vercel sets this in every serverless function invocation. Used to
  // decide whether the session cookie requires HTTPS (Secure) — local
  // dev runs over plain http://localhost, which can't set/read Secure
  // cookies at all.
  return Boolean(process.env.VERCEL);
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password, hash) {
  if (!hash) return false;
  return bcrypt.compare(password, hash);
}

export function createSessionCookie(user) {
  const token = jwt.sign({ id: user.id, email: user.email, name: user.name }, secret(), {
    expiresIn: `${SESSION_DAYS}d`,
  });
  return serializeCookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: isProdHost(),
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export function clearSessionCookie() {
  return serializeCookie(COOKIE_NAME, "", {
    httpOnly: true,
    secure: isProdHost(),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

// Reads and verifies the session cookie off a request. Returns
// { id, email, name } or null — never throws.
export function getUserFromRequest(req) {
  const header = req.headers?.cookie;
  if (!header) return null;
  const cookies = parseCookieHeader(header);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    const { id, email, name } = jwt.verify(token, secret());
    return { id, email, name };
  } catch {
    return null;
  }
}

// Resolves a session cookie all the way to a live role/allowedTags —
// looked up fresh from the database on every call rather than baked
// into the JWT, so promoting/demoting a user or changing their
// allowed tags takes effect on their very next request instead of
// waiting for them to log in again. Returns null if the account was
// deleted since the token was issued (treated as logged out).
export async function getSessionUser(req) {
  const identity = getUserFromRequest(req);
  if (!identity) return null;
  let row;
  try {
    row = await getUserById(identity.id);
  } catch (err) {
    console.error("[auth] user lookup failed", err);
    return null;
  }
  if (!row) return null;
  return {
    id: identity.id,
    email: row.email,
    name: row.name,
    role: row.role || "admin",
    allowedTags: row.allowed_tags || [],
  };
}

// ---------- API keys (programmatic/agent access) ----------
// A key is a bearer credential equivalent to being logged in — it's
// meant for scripts and agents that can't hold a session cookie, not
// as a separate permission tier. Format: "sk_" + 32 random bytes as
// hex, e.g. sk_3f9a1c... Only its SHA-256 hash is ever stored — a
// fast hash is correct here (unlike a password) because the raw key
// already has 256 bits of entropy, nothing to brute-force.
const API_KEY_PREFIX = "sk_";

export function generateApiKey() {
  return API_KEY_PREFIX + crypto.randomBytes(32).toString("hex");
}

export function hashApiKey(rawKey) {
  return crypto.createHash("sha256").update(rawKey).digest("hex");
}

// Extracts a bearer key from `Authorization: Bearer <key>` or the
// `X-Api-Key` header, verifies it against the database, and — if
// valid — returns a synthetic "user" so the rest of the app doesn't
// need to know the difference. Updates last_used_at in the
// background (never blocks or fails the request over it).
async function getUserFromApiKey(req) {
  const authHeader = req.headers?.authorization || "";
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  const rawKey = (bearerMatch ? bearerMatch[1] : req.headers?.["x-api-key"] || "").trim();
  if (!rawKey || !rawKey.startsWith(API_KEY_PREFIX)) return null;

  // A DB error here (not configured, connection dropped, …) should
  // just mean "can't verify this key right now" — the caller falls
  // through to the normal 401, not a crashed request. requireAuth is
  // called from Express's global middleware with no surrounding
  // try/catch, so letting this throw would take the whole request
  // down with it.
  let row;
  try {
    row = await findApiKeyByHash(hashApiKey(rawKey));
  } catch (err) {
    console.error("[auth] API key lookup failed", err);
    return null;
  }
  if (!row) return null;

  touchApiKeyLastUsed(row.id).catch(() => {});
  // A key is only ever mintable by an already-logged-in user (see
  // api/api-keys.js), so it's treated as full access, same as admin —
  // there's no "client-role key" concept.
  return {
    id: `api-key:${row.id}`,
    name: `API key (${row.label})`,
    email: null,
    isApiKey: true,
    role: "admin",
    allowedTags: [],
  };
}

// For Vercel functions: call at the top of any handler that needs a
// logged-in user OR a valid API key. Returns the user, or null after
// already writing a 401 response (so the caller can just
// `if (!user) return;`). Async because the API-key path needs a
// database lookup — every caller must `await` this now.
export async function requireAuth(req, res) {
  const sessionUser = await getSessionUser(req);
  if (sessionUser) return sessionUser;

  const apiUser = await getUserFromApiKey(req);
  if (apiUser) return apiUser;

  res.status(401).json({ error: "Not authenticated" });
  return null;
}
