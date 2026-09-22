// Validation for crypto payout addresses and UPI IDs.
// Litecoin: bech32 (ltc1...) and legacy P2PKH/P2SH (L.../M...) with real checksum verification.
import { createHash } from 'node:crypto';

const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const BECH32_GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function isValidLtcAddress(input) {
  const address = String(input || '').trim();
  if (!address) return false;
  if (/^[LM][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(address)) {
    try {
      const bytes = base58Decode(address);
      if (bytes.length !== 25) return false;
      const payload = Buffer.from(bytes.slice(0, 21));
      const checksum = Buffer.from(bytes.slice(21));
      const hash = createHash('sha256').update(createHash('sha256').update(payload).digest()).digest();
      return hash.subarray(0, 4).equals(checksum);
    } catch { return false; }
  }
  if (/^ltc1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{6,87}$/i.test(address)) {
    try { return isValidSegwitBech32(address.toLowerCase(), 'ltc'); } catch { return false; }
  }
  return false;
}

// Generalized segwit bech32 verifier (exported for testing against BIP-173 vectors)
export function isValidSegwitBech32(address, prefix) {
  return bech32Verify(address.toLowerCase(), prefix);
}

function base58Decode(input) {
  const bytes = [0];
  for (const char of input) {
    const value = BASE58_ALPHABET.indexOf(char);
    if (value < 0) throw new Error('bad base58 character');
    let carry = value;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  for (let i = 0; i < input.length && input[i] === '1'; i++) bytes.push(0);
  return bytes.reverse();
}

function bech32Verify(address, prefix) {
  const { hrp, values } = bech32Decode(address);
  if (hrp !== prefix) return false;
  // Verify BCH checksum (polymod over hrp expand + data + checksum must equal 1)
  let chk = 1;
  for (const v of [...hrpExpand(prefix), ...values]) {
    const top = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >> i) & 1) chk ^= BECH32_GEN[i];
  }
  if (chk !== 1) return false;
  // Validate the witness program: values[-6:] is the checksum, [0] is the version, rest is the program
  const payload = values.slice(0, -6);
  if (!payload.length) return false;
  const version = payload[0];
  if (version > 16) return false;
  const program = convertBits(payload.slice(1), 5, 8, false);
  if (!program) return false;
  if (version === 0) return program.length === 20 || program.length === 32;
  return program.length >= 2 && program.length <= 40;
}

// BIP-173 regroup bit conversion; returns null when padding is invalid
function convertBits(data, from, to, pad) {
  let acc = 0, bits = 0;
  const out = [];
  const maxv = (1 << to) - 1;
  for (const value of data) {
    if (value < 0 || (value >> from) !== 0) return null;
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) { bits -= to; out.push((acc >> bits) & maxv); }
  }
  if (pad) { if (bits) out.push((acc << (to - bits)) & maxv); }
  else if (bits >= from || ((acc << (to - bits)) & maxv)) return null;
  return out;
}

function bech32Decode(address) {
  const pos = address.lastIndexOf('1');
  if (pos < 1 || pos + 6 >= address.length) throw new Error('bad bech32 layout');
  const hrp = address.slice(0, pos);
  const dataPart = address.slice(pos + 1);
  const values = [];
  for (const char of dataPart) {
    const value = BECH32_CHARSET.indexOf(char);
    if (value < 0) throw new Error('bad bech32 character');
    values.push(value);
  }
  return { hrp, values };
}

function hrpExpand(hrp) {
  const high = [];
  for (const char of hrp) high.push(char.charCodeAt(0) >> 5);
  high.push(0);
  for (const char of hrp) high.push(char.charCodeAt(0) & 31);
  return high;
}

// --- UPI VPA ---
export function isValidUpiId(input) {
  const vpa = String(input || '').trim();
  return /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/.test(vpa);
}

export function normalizeUpiId(input) {
  return String(input || '').trim().toLowerCase();
}
