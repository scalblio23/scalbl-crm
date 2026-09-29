#!/usr/bin/env node
// Sets up the SIP voice gateway on DigitalOcean through its API:
//   1. creates a Sydney Droplet (Ubuntu 24.04, $6/mo) whose first boot
//      runs setup.sh unattended via cloud-init — Node, the app, the
//      .env, the systemd service and HTTPS;
//   2. puts it behind a DigitalOcean Cloud Firewall (SSH, 80/443, and
//      UDP 10000-10999 for call audio);
//   3. points VOICE_DOMAIN's A record at it, if that domain's DNS is
//      hosted on DigitalOcean;
//   4. waits for https://VOICE_DOMAIN/health to report "registered".
//
// Usage (Node 18+):
//   DIGITALOCEAN_TOKEN=... VOICE_DOMAIN=voice.example.com \
//   SIP_PASSWORD=... GITHUB_TOKEN=... [POSTGRES_URL=...] \
//   node deploy/voice-gateway/provision-do.mjs [--replace] [--dry-run]
//
// A Droplet named DROPLET_NAME (default "scalbl-voice") that already
// exists is left alone — the API can't run commands inside an existing
// Droplet — but still gets the firewall and DNS record; pass --replace
// to destroy it and create a fresh, fully configured one instead.
//
// Note: cloud-init user data (which carries the secrets to the new
// Droplet) is readable from inside that Droplet via its metadata
// service — the same place the secrets end up anyway, in its .env.
import crypto from "crypto";

const env = process.env;
const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const REPLACE = args.has("--replace");

const TOKEN = env.DIGITALOCEAN_TOKEN || env.DO_TOKEN;
const DOMAIN = (env.VOICE_DOMAIN || "").trim().toLowerCase();
const NAME = env.DROPLET_NAME || "scalbl-voice";
const REGION = env.DO_REGION || "syd1";
const SIZE = env.DO_SIZE || "s-1vcpu-1gb";
const REPO = "scalblio23/scalbl-crm";
const BRANCH = env.BRANCH || "claude/optimistic-franklin-6gwm5z";
const FIREWALL_NAME = `${NAME}-firewall`;

function die(msg) {
  console.error(`✖ ${msg}`);
  process.exit(1);
}

const missing = [];
if (!TOKEN) missing.push("DIGITALOCEAN_TOKEN");
if (!DOMAIN) missing.push("VOICE_DOMAIN");
if (!env.SIP_PASSWORD && (REPLACE || !DRY_RUN)) missing.push("SIP_PASSWORD");
if (missing.length) die(`Missing env: ${missing.join(", ")}`);

async function api(method, path, body) {
  if (DRY_RUN && method !== "GET") {
    console.log(`  [dry-run] ${method} ${path}`);
    return {};
  }
  const res = await fetch(`https://api.digitalocean.com/v2${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return {};
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${data.message || res.statusText}`);
  return data;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shq = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`; // POSIX shell quoting

function userData(gwSecret) {
  const vars = {
    DOMAIN,
    GH_TOKEN: env.GITHUB_TOKEN || "",
    SIP_PASSWORD: env.SIP_PASSWORD,
    GW_SECRET: gwSecret,
    PG_URL: env.POSTGRES_URL || "",
    REWRITE_ENV: "yes",
    BRANCH,
  };
  const auth = env.GITHUB_TOKEN ? `-H "Authorization: token $GH_TOKEN" ` : "";
  return [
    "#!/bin/bash",
    "set -e",
    ...Object.entries(vars).map(([k, v]) => `export ${k}=${shq(v)}`),
    `curl -fsSL ${auth}https://raw.githubusercontent.com/${REPO}/refs/heads/${BRANCH}/deploy/voice-gateway/setup.sh -o /root/scalbl-setup.sh`,
    "bash /root/scalbl-setup.sh > /var/log/scalbl-setup.log 2>&1",
    "",
  ].join("\n");
}

async function findDroplet() {
  const { droplets = [] } = await api("GET", `/droplets?per_page=200`);
  return droplets.find((d) => d.name === NAME) || null;
}

function publicIp(droplet) {
  return droplet?.networks?.v4?.find((n) => n.type === "public")?.ip_address || "";
}

async function createDroplet(gwSecret) {
  const { ssh_keys = [] } = await api("GET", "/account/keys?per_page=200");
  console.log(`• Creating Droplet "${NAME}" (${REGION}, ${SIZE}, Ubuntu 24.04)…`);
  const { droplet } = await api("POST", "/droplets", {
    name: NAME,
    region: REGION,
    size: SIZE,
    image: "ubuntu-24-04-x64",
    ipv6: false,
    monitoring: true,
    ssh_keys: ssh_keys.map((k) => k.id),
    tags: ["scalbl-voice"],
    user_data: userData(gwSecret),
  });
  if (DRY_RUN) return { id: 0, networks: { v4: [{ type: "public", ip_address: "203.0.113.10" }] } };
  if (!ssh_keys.length) console.log("  (No SSH keys on the account — DigitalOcean will email you the root password.)");
  for (let i = 0; i < 60; i++) {
    const { droplet: d } = await api("GET", `/droplets/${droplet.id}`);
    if (d.status === "active" && publicIp(d)) return d;
    await sleep(5000);
  }
  die("The Droplet didn't become active within 5 minutes — check the DigitalOcean dashboard.");
}

async function ensureFirewall(dropletId) {
  const { firewalls = [] } = await api("GET", "/firewalls?per_page=200");
  const existing = firewalls.find((f) => f.name === FIREWALL_NAME);
  if (existing) {
    if (!existing.droplet_ids.includes(dropletId)) {
      await api("POST", `/firewalls/${existing.id}/droplets`, { droplet_ids: [dropletId] });
    }
    console.log(`• Firewall "${FIREWALL_NAME}" attached.`);
    return;
  }
  const anywhere = { addresses: ["0.0.0.0/0", "::/0"] };
  await api("POST", "/firewalls", {
    name: FIREWALL_NAME,
    droplet_ids: [dropletId],
    inbound_rules: [
      { protocol: "tcp", ports: "22", sources: anywhere },
      { protocol: "tcp", ports: "80", sources: anywhere },
      { protocol: "tcp", ports: "443", sources: anywhere },
      { protocol: "udp", ports: "10000-10999", sources: anywhere }, // call audio (RTP)
    ],
    outbound_rules: [
      { protocol: "tcp", ports: "all", destinations: anywhere },
      { protocol: "udp", ports: "all", destinations: anywhere },
      { protocol: "icmp", destinations: anywhere },
    ],
  });
  console.log(`• Firewall "${FIREWALL_NAME}" created (SSH, 80/443, UDP 10000-10999).`);
}

// Returns true if the record was set, false if the domain isn't on DO.
async function ensureDns(ip) {
  const { domains = [] } = await api("GET", "/domains?per_page=200");
  const zone = domains
    .map((d) => d.name)
    .filter((z) => DOMAIN === z || DOMAIN.endsWith(`.${z}`))
    .sort((a, b) => b.length - a.length)[0];
  if (!zone) return false;
  const sub = DOMAIN === zone ? "@" : DOMAIN.slice(0, -(zone.length + 1));
  const { domain_records = [] } = await api("GET", `/domains/${zone}/records?type=A&name=${DOMAIN}&per_page=200`);
  const record = domain_records.find((r) => r.type === "A" && r.name === sub);
  if (record) {
    if (record.data !== ip) await api("PUT", `/domains/${zone}/records/${record.id}`, { data: ip, ttl: 300 });
  } else {
    await api("POST", `/domains/${zone}/records`, { type: "A", name: sub, data: ip, ttl: 300 });
  }
  console.log(`• DNS: ${DOMAIN} → ${ip} (zone ${zone} on DigitalOcean).`);
  return true;
}

async function waitForHealth() {
  console.log(`• Waiting for https://${DOMAIN}/health (first boot + HTTPS certificate take a few minutes)…`);
  for (let i = 0; i < 90; i++) {
    try {
      const res = await fetch(`https://${DOMAIN}/health`);
      const body = await res.json();
      if (body.registration?.state === "registered") return "registered";
      if (body.registration?.state === "failed") return `failed: ${body.registration.error}`;
    } catch {
      // not up yet
    }
    await sleep(10000);
  }
  return "timeout";
}

// ---------- run ----------
const gwSecret = env.VOICE_GATEWAY_SECRET || crypto.randomBytes(32).toString("hex");
let droplet = await findDroplet();
let created = false;

if (droplet && REPLACE) {
  console.log(`• Destroying existing Droplet "${NAME}" (${publicIp(droplet)})…`);
  await api("DELETE", `/droplets/${droplet.id}`);
  droplet = null;
  if (!DRY_RUN) await sleep(5000);
}
if (!droplet) {
  droplet = await createDroplet(gwSecret);
  created = true;
} else {
  console.log(`• Using existing Droplet "${NAME}" (${publicIp(droplet)}) — not reconfiguring it (see --replace).`);
}

const ip = publicIp(droplet);
console.log(`  Public IP: ${ip}`);
await ensureFirewall(droplet.id);
const dnsSet = await ensureDns(ip);
if (!dnsSet) {
  console.log(`• DNS for ${DOMAIN} isn't hosted on DigitalOcean — add this record where it is:`);
  console.log(`    Type A · Name ${DOMAIN.split(".")[0]} · Value ${ip} · TTL 300`);
}

if (!created) {
  console.log(`
The existing Droplet still needs the app installed. Open it in the
DigitalOcean dashboard → Console, and run:

  bash <(curl -fsSL -H "Authorization: token <GITHUB_TOKEN>" \\
    https://raw.githubusercontent.com/${REPO}/refs/heads/${BRANCH}/deploy/voice-gateway/setup.sh)
`);
} else if (!DRY_RUN) {
  const result = dnsSet ? await waitForHealth() : "dns-pending";
  if (result === "registered") console.log("✔ Gateway is up and registered with VoIPcloud.");
  else if (result === "dns-pending") console.log("• Once the DNS record is in place, check https://" + DOMAIN + "/health");
  else console.log(`✖ Gateway not registered yet (${result}). On the Droplet: cat /var/log/scalbl-setup.log; journalctl -u scalbl-voice -n 50`);
}

console.log(`
Set these in Vercel → Settings → Environment Variables, then redeploy:
  VOICE_PROVIDER=sip
  VOICE_GATEWAY_URL=wss://${DOMAIN}/voice
  VOICE_GATEWAY_SECRET=${created ? gwSecret : "<the value in /opt/scalbl-crm/.env on the Droplet>"}
  SIP_CALLER_ID=+61480851534`);
