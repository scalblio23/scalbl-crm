// Caller-ID rotation (SIP_CALLER_IDS): each outbound call presents the
// next number, in the From header and P-Asserted-Identity.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FakeTrunk, newTag } from "./fakeTrunk.js";
import { loadSipConfig } from "../config.js";
import { SipUserAgent } from "../ua.js";

const quiet = { log() {}, warn() {} };

async function startUa(extraEnv) {
  const trunk = new FakeTrunk({ username: "T909317", password: "pw" });
  const port = await trunk.listen();
  const ua = new SipUserAgent(
    loadSipConfig({
      SIP_SERVER: "127.0.0.1",
      SIP_PORT: String(port),
      SIP_DOMAIN: "sipm5.au.voipcloud.online",
      SIP_USERNAME: "T909317",
      SIP_PASSWORD: "pw",
      SIP_MAX_CHANNELS: "1",
      SIP_RTP_PORTS: "43000-43999",
      ...extraEnv,
    }),
    { log: quiet }
  );
  await new Promise((resolve) => {
    ua.on("registration", (r) => r.state === "registered" && resolve());
    ua.start();
  });
  return { trunk, ua };
}

// Dials once, returns the INVITE (after auth), and ends the call busy.
async function dialOnce(trunk, ua) {
  const invitePromise = trunk.next("invite");
  const call = ua.dial("0412345678");
  const invite = await invitePromise;
  const ended = new Promise((r) => call.once("ended", r));
  trunk.reply(invite, 486, "Busy Here", { toTag: newTag() });
  await ended;
  return { invite, call };
}

test("SIP_CALLER_IDS: calls rotate through the numbers, in From and PAI", async () => {
  const { trunk, ua } = await startUa({
    SIP_CALLER_ID: "+61480851534",
    SIP_CALLER_IDS: "+61480851534, 0485 998 251, 61485991651",
  });
  try {
    const seen = [];
    for (let i = 0; i < 4; i++) {
      const { invite, call } = await dialOnce(trunk, ua);
      seen.push(call.callerId);
      assert.match(invite.get("from"), new RegExp(`<sip:\\${call.callerId}@sipm5\\.au\\.voipcloud\\.online>`));
      assert.match(invite.get("p-asserted-identity"), new RegExp(`<sip:\\${call.callerId}@`));
    }
    assert.deepEqual(seen, ["+61480851534", "+61485998251", "+61485991651", "+61480851534"]);
    assert.deepEqual(ua.status().callerIds, ["+61480851534", "+61485998251", "+61485991651"]);
  } finally {
    await ua.stop();
    trunk.close();
  }
});

test("SIP_CALLER_ID_FORMAT=national writes the caller ID as 04…", async () => {
  const { trunk, ua } = await startUa({
    SIP_CALLER_IDS: "+61485998251",
    SIP_CALLER_ID_FORMAT: "national",
  });
  try {
    const { invite } = await dialOnce(trunk, ua);
    assert.match(invite.get("from"), /<sip:0485998251@sipm5\.au\.voipcloud\.online>/);
  } finally {
    await ua.stop();
    trunk.close();
  }
});
