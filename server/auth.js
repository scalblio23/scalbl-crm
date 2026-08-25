// Shared auth logic — used by both the local Express server and the
// Vercel serverless functions, same pattern as twilioCore.js/db.js.
// Sessions are a signed, HttpOnly cookie holding a JWT (no server-side
// session store needed). Users are invite-only: an admin seeds a row
// in `users` with an email and no password, and that person claims
// the account once via "set password" — nobody can self-register with
// an arbitrary email.
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

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

// For Vercel functions: call at the top of any handler that needs a
// logged-in user. Returns the user, or null after already writing a
// 401 response (so the caller can just `if (!user) return;`).
export function requireAuth(req, res) {
  const user = getUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  return user;
}
