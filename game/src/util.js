// Shared helpers for SOLMAR BAY: a seeded RNG, small math, and colour helpers.
// Everything here is original code written for this game.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed) {
  const rand = mulberry32(seed);
  return {
    next: rand,
    range: (lo, hi) => lo + rand() * (hi - lo),
    int: (lo, hi) => Math.floor(lo + rand() * (hi - lo + 1)),
    pick: (arr) => arr[Math.floor(rand() * arr.length)],
    chance: (p) => rand() < p,
  };
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export function angleLerp(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
export const dist2d = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

/** Format in-game cash, e.g. 1250 -> "$1,250". */
export function money(n) {
  return '$' + Math.floor(n).toLocaleString('en-US');
}

/** Make a small canvas and return it (used for procedural textures). */
export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** A palette of original Solmar Bay building colours. */
export const BUILDING_COLORS = [
  0xd8c9a3, 0xc9b18c, 0xb7a6d6, 0x9fb8c8, 0xd6a58c, 0xa8c4a0, 0xe0d6c2, 0x8fa3b8,
  0xc98f7a, 0xb5c0c9, 0xd9c27a, 0x9aa98f, 0xc2a1b0, 0x87a8b8, 0xd0b49a, 0xa3b8a0,
];

/** Car paint colours (original Solmar Bay palette). */
export const CAR_COLORS = [
  0xc23b2e, 0x2e6fc2, 0xe8c832, 0x2fb573, 0xe8e4da, 0x22242a, 0x7a4fc2, 0xe07b2e,
  0x3aa7a3, 0xb03a6b, 0x5a7a2e, 0x8a8f96,
];

export const CAR_NAMES = [
  'Comet GT', 'Marina Cruiser', 'Bay Runner', 'Sunset Coupe', 'Harbor Van',
  'Palm Sedan', 'Coral Hatch', 'Dune Buggy', 'Vista Wagon', 'Neon Taxi',
];
