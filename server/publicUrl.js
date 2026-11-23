// The CRM's own public address, for links in emails/texts and webhook
// URLs: PUBLIC_URL when set, else the Vercel deployment's URL. Empty in
// local dev without PUBLIC_URL.
export function publicBaseUrl(env = process.env) {
  if (env.PUBLIC_URL) return env.PUBLIC_URL.replace(/\/+$/, "");
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  return "";
}
