// G.711 A-law (PCMA, payload type 8) and u-law (PCMU, payload type 0)
// codecs — 16-bit linear PCM <-> 8-bit companded samples, 8 kHz.
// Decoding uses precomputed tables; encoding is the classic ITU-T
// segment search.

// A-law segment end points, on the 13-bit magnitude (sample >> 3).
const SEG_AEND = [0x1f, 0x3f, 0x7f, 0xff, 0x1ff, 0x3ff, 0x7ff, 0xfff];

function segment(value) {
  for (let i = 0; i < SEG_AEND.length; i++) if (value <= SEG_AEND[i]) return i;
  return SEG_AEND.length;
}

function linearToAlaw(sample) {
  let pcm = sample >> 3;
  let mask;
  if (pcm >= 0) {
    mask = 0xd5;
  } else {
    mask = 0x55;
    pcm = -pcm - 1;
  }
  const seg = segment(pcm);
  if (seg >= 8) return 0x7f ^ mask;
  let aval = seg << 4;
  aval |= seg < 2 ? (pcm >> 1) & 0x0f : (pcm >> seg) & 0x0f;
  return aval ^ mask;
}

function alawToLinear(aval) {
  aval ^= 0x55;
  let t = (aval & 0x0f) << 4;
  const seg = (aval & 0x70) >> 4;
  if (seg === 0) t += 8;
  else if (seg === 1) t += 0x108;
  else {
    t += 0x108;
    t <<= seg - 1;
  }
  return aval & 0x80 ? t : -t;
}

const BIAS = 0x84;
const CLIP = 32635;

function linearToUlaw(sample) {
  let pcm = sample;
  const sign = pcm < 0 ? 0x80 : 0;
  if (sign) pcm = -pcm;
  if (pcm > CLIP) pcm = CLIP;
  pcm += BIAS;
  let exponent = 7;
  for (let mask = 0x4000; (pcm & mask) === 0 && exponent > 0; exponent--, mask >>= 1);
  const mantissa = (pcm >> (exponent + 3)) & 0x0f;
  return ~(sign | (exponent << 4) | mantissa) & 0xff;
}

function ulawToLinear(uval) {
  uval = ~uval & 0xff;
  let t = ((uval & 0x0f) << 3) + BIAS;
  t <<= (uval & 0x70) >> 4;
  return uval & 0x80 ? BIAS - t : t - BIAS;
}

const ALAW_DECODE = new Int16Array(256);
const ULAW_DECODE = new Int16Array(256);
for (let i = 0; i < 256; i++) {
  ALAW_DECODE[i] = alawToLinear(i);
  ULAW_DECODE[i] = ulawToLinear(i);
}

// Encode tables indexed by (sample >> 2) + 8192 — 14-bit resolution is
// all G.711 keeps anyway, and a lookup is far cheaper per sample.
const ALAW_ENCODE = new Uint8Array(16384);
const ULAW_ENCODE = new Uint8Array(16384);
for (let i = 0; i < 16384; i++) {
  const sample = (i - 8192) << 2;
  ALAW_ENCODE[i] = linearToAlaw(sample);
  ULAW_ENCODE[i] = linearToUlaw(sample);
}

export function encode(codecName, pcm /* Int16Array */) {
  const table = codecName === "PCMU" ? ULAW_ENCODE : ALAW_ENCODE;
  const out = Buffer.allocUnsafe(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = table[(pcm[i] >> 2) + 8192];
  return out;
}

export function decode(codecName, payload /* Buffer */) {
  const table = codecName === "PCMU" ? ULAW_DECODE : ALAW_DECODE;
  const out = new Int16Array(payload.length);
  for (let i = 0; i < payload.length; i++) out[i] = table[payload[i]];
  return out;
}

// The encoded byte for digital silence — used to pace RTP when there's
// no microphone audio, so NAT bindings stay open and the far end
// doesn't treat the stream as dead.
export function silenceByte(codecName) {
  return codecName === "PCMU" ? 0xff : 0xd5;
}
