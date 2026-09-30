#!/usr/bin/env bash
# One-shot setup for the SIP voice gateway on a fresh Ubuntu 24.04
# DigitalOcean Droplet (run as root, e.g. from the Droplet's Console):
#
#   bash <(curl -fsSL -H "Authorization: token <GITHUB_TOKEN>" \
#     https://raw.githubusercontent.com/scalblio23/scalbl-crm/refs/heads/<BRANCH>/deploy/voice-gateway/setup.sh)
#
# It installs Node + Caddy, fetches the app, asks for the SIP password
# and other settings, runs the gateway as a service that restarts on
# failure/reboot, puts it behind HTTPS, and opens the firewall.
# Safe to re-run: it updates the code and keeps the existing .env
# unless you choose to rewrite it.
#
# Every prompt can be answered up front with an environment variable
# instead (DOMAIN, GH_TOKEN, SIP_PASSWORD, GW_SECRET, PG_URL,
# REWRITE_ENV=yes|no), so it also runs unattended — that's how
# provision-do.mjs runs it via cloud-init on a new Droplet.
set -euo pipefail

REPO="scalblio23/scalbl-crm"
BRANCH="${BRANCH:-claude/optimistic-franklin-6gwm5z}"
APP_DIR="/opt/scalbl-crm"
APP_USER="scalbl"
SERVICE="scalbl-voice"

if [[ $EUID -ne 0 ]]; then
  echo "Run this as root (sudo -i first)." >&2
  exit 1
fi

echo "== Scalbl voice gateway setup =="
# ask VAR "prompt" [secret] — only prompts if VAR isn't already set.
ask() {
  local var="$1" prompt="$2" secret="${3:-}"
  [[ -n "${!var+x}" ]] && return 0
  if [[ -n "$secret" ]]; then read -rsp "$prompt" "$var"; echo; else read -rp "$prompt" "$var"; fi
}
ask DOMAIN "Subdomain for the gateway (e.g. voice.yourdomain.com): "
[[ -n "$DOMAIN" ]] || { echo "A subdomain is required." >&2; exit 1; }
ask GH_TOKEN "GitHub token with read access to $REPO (blank if the repo is public): " secret

# ---------- packages ----------
echo "== Installing Node.js 22, Caddy, git and the firewall =="
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl git ufw ffmpeg ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https >/dev/null
if ! command -v node >/dev/null || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt >/etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
fi

# ---------- code ----------
echo "== Fetching the app ($BRANCH) =="
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
if [[ -n "$GH_TOKEN" ]]; then
  REPO_URL="https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git"
else
  REPO_URL="https://github.com/${REPO}.git"
fi
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" remote set-url origin "$REPO_URL"
  git -C "$APP_DIR" fetch -q origin "$BRANCH"
  git -C "$APP_DIR" checkout -q -B "$BRANCH" "origin/$BRANCH"
else
  git clone -q --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
fi
# Don't leave the token sitting in .git/config.
git -C "$APP_DIR" remote set-url origin "https://github.com/${REPO}.git"
(cd "$APP_DIR" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)

# ---------- settings ----------
ENV_FILE="$APP_DIR/.env"
WRITE_ENV=yes
if [[ -f "$ENV_FILE" ]]; then
  ask REWRITE_ENV "An .env already exists — rewrite it? [y/N] "
  [[ "$REWRITE_ENV" =~ ^[Yy] ]] || WRITE_ENV=no
fi
GENERATED_SECRET=no
if [[ "$WRITE_ENV" == yes ]]; then
  ask SIP_PASSWORD "VoIPcloud SIP password for T909317: " secret
  [[ -n "$SIP_PASSWORD" ]] || { echo "The SIP password is required." >&2; exit 1; }
  ask GW_SECRET "VOICE_GATEWAY_SECRET (blank = generate one): " secret
  if [[ -z "$GW_SECRET" ]]; then
    GW_SECRET="$(openssl rand -hex 32)"
    GENERATED_SECRET=yes
  fi
  ask PG_URL "POSTGRES_URL (same as Vercel; blank to skip missed-call logging): " secret
  # The Droplet's public IP, straight from DigitalOcean's metadata service.
  PUBLIC_IP="$(curl -fsS --max-time 3 http://169.254.169.254/metadata/v1/interfaces/public/0/ipv4/address || true)"

  quote() { # dotenv-safe quoting: '…', else "…", else `…`
    local v="$1"
    if [[ "$v" != *"'"* ]]; then printf "'%s'" "$v"
    elif [[ "$v" != *'"'* ]]; then printf '"%s"' "$v"
    elif [[ "$v" != *'`'* ]]; then printf '`%s`' "$v"
    else echo "A value contains ', \" and \` — can't be written to .env safely; change it." >&2; exit 1
    fi
  }
  umask 077
  {
    echo "VOICE_PROVIDER=sip"
    echo "SIP_SERVER=sipm5.au.voipcloud.online"
    echo "SIP_PORT=7060"
    echo "SIP_TRANSPORT=tcp"
    echo "SIP_USERNAME=T909317"
    echo "SIP_PASSWORD=$(quote "$SIP_PASSWORD")"
    echo "SIP_CALLER_ID=+61480851534"
    echo "SIP_MAX_CHANNELS=1"
    echo "SIP_RING_TIMEOUT=60"
    echo "SIP_RTP_PORTS=10000-10999"
    if [[ -n "$PUBLIC_IP" ]]; then echo "SIP_PUBLIC_IP=$PUBLIC_IP"; fi
    echo "VOICE_GATEWAY_PORT=3002"
    echo "VOICE_GATEWAY_SECRET=$(quote "$GW_SECRET")"
    if [[ -n "$PG_URL" ]]; then echo "POSTGRES_URL=$(quote "$PG_URL")"; fi
  } >"$ENV_FILE"
  umask 022
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chmod 600 "$ENV_FILE"

# ---------- service ----------
echo "== Installing the $SERVICE service =="
cat >/etc/systemd/system/$SERVICE.service <<EOF
[Unit]
Description=Scalbl CRM SIP voice gateway
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node server/voiceGateway.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
# WhatsApp service (team WhatsApp linked by QR for the CSM tab) — its
# own service so restarting it never drops a call, and vice versa.
cat >/etc/systemd/system/scalbl-whatsapp.service <<EOF
[Unit]
Description=Scalbl CRM WhatsApp service
After=network-online.target
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node server/whatsappGateway.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable -q "$SERVICE" scalbl-whatsapp
systemctl restart "$SERVICE" scalbl-whatsapp

# ---------- HTTPS ----------
echo "== Configuring HTTPS for $DOMAIN =="
cat >/etc/caddy/Caddyfile <<EOF
$DOMAIN {
  handle /whatsapp/* {
    reverse_proxy localhost:3003
  }
  handle {
    reverse_proxy localhost:3002
  }
}
EOF
systemctl enable -q caddy
systemctl restart caddy

# ---------- firewall ----------
echo "== Opening the firewall =="
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 10000:10999/udp >/dev/null # call audio (RTP)
ufw --force enable >/dev/null

# ---------- check ----------
echo "== Waiting for the trunk to register =="
STATE=""
for _ in $(seq 1 15); do
  sleep 2
  STATE="$(curl -fsS http://localhost:3002/health 2>/dev/null | grep -o '"state":"[a-z]*"' | head -1 || true)"
  if [[ "$STATE" == '"state":"registered"' ]]; then break; fi
done

echo
if [[ "$STATE" == '"state":"registered"' ]]; then
  echo "✔ Registered with VoIPcloud."
else
  echo "✖ Not registered yet ($STATE). Check the logs: journalctl -u $SERVICE -n 50"
fi
echo
echo "Health:  https://$DOMAIN/health   (needs the DNS record pointing at this server)"
echo "Logs:    journalctl -u $SERVICE -f"
echo "Restart: systemctl restart $SERVICE"
echo
echo "Now set these in Vercel → Settings → Environment Variables, then redeploy:"
echo "  VOICE_PROVIDER=sip"
echo "  VOICE_GATEWAY_URL=wss://$DOMAIN/voice"
if [[ "$WRITE_ENV" == yes && "$GENERATED_SECRET" == yes ]]; then
  echo "  VOICE_GATEWAY_SECRET=$GW_SECRET"
else
  echo "  VOICE_GATEWAY_SECRET=<the same value as in $ENV_FILE>"
fi
echo "  SIP_CALLER_ID=+61480851534"
