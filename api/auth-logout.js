import { clearSessionCookie } from "../server/auth.js";

export default function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  res.setHeader("Set-Cookie", clearSessionCookie());
  res.status(204).end();
}
