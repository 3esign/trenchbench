// ============================================================
//  keccak-256 (the Ethereum variant — NOT the NIST SHA3-256 that
//  node:crypto provides; they differ in one padding byte).
//  Needed to compute event topic hashes and Uniswap v4 pool ids.
//  Pure JS, no dependencies. Verified against published test vectors.
// ============================================================

const RC = [
  0x00000001n, 0x00008082n, 0x800000000000808An, 0x8000000080008000n,
  0x000000000000808Bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008An, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000An,
  0x000000008000808Bn, 0x800000000000008Bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800An, 0x800000008000000An,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n
];
const ROT = [
   0, 1, 62, 28, 27,
  36, 44,  6, 55, 20,
   3, 10, 43, 25, 39,
  41, 45, 15, 21,  8,
  18,  2, 61, 56, 14
];
const M64 = (1n << 64n) - 1n;
const rotl = (x, n) => n === 0n ? x : (((x << n) | (x >> (64n - n))) & M64);

function keccakF(A) {
  for (let round = 0; round < 24; round++) {
    // theta
    const C = new Array(5);
    for (let x = 0; x < 5; x++) C[x] = A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20];
    for (let x = 0; x < 5; x++) {
      const D = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1n);
      for (let y = 0; y < 5; y++) A[x + 5 * y] = (A[x + 5 * y] ^ D) & M64;
    }
    // rho + pi
    const B = new Array(25).fill(0n);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++)
      B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(A[x + 5 * y], BigInt(ROT[x + 5 * y]));
    // chi
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++)
      A[x + 5 * y] = (B[x + 5 * y] ^ ((~B[((x + 1) % 5) + 5 * y] & M64) & B[((x + 2) % 5) + 5 * y])) & M64;
    // iota
    A[0] = (A[0] ^ RC[round]) & M64;
  }
  return A;
}

export function keccak256(input) {
  const bytes = typeof input === 'string'
    ? (input.startsWith('0x') ? Uint8Array.from(input.slice(2).match(/../g) || [], h => parseInt(h, 16))
                              : new TextEncoder().encode(input))
    : Uint8Array.from(input);

  const RATE = 136; // 1088 bits for keccak-256
  const padLen = RATE - (bytes.length % RATE);
  const padded = new Uint8Array(bytes.length + padLen);
  padded.set(bytes);
  padded[bytes.length] |= 0x01;          // keccak padding (SHA3 would use 0x06)
  padded[padded.length - 1] |= 0x80;

  let A = new Array(25).fill(0n);
  for (let off = 0; off < padded.length; off += RATE) {
    for (let i = 0; i < RATE / 8; i++) {
      let lane = 0n;
      for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(padded[off + i * 8 + b]);
      A[i] ^= lane;
    }
    A = keccakF(A);
  }

  let out = '0x';
  for (let i = 0; i < 4; i++) {
    let lane = A[i];
    for (let b = 0; b < 8; b++) { out += (lane & 0xffn).toString(16).padStart(2, '0'); lane >>= 8n; }
  }
  return out;
}

// topic0 for an event signature, e.g. "Swap(bytes32,address,int128,...)"
export const eventTopic = sig => keccak256(sig);
