import { RESOURCES } from "./constants.js";

export function makeSeededRng(seedInput = `${Date.now()}`) {
  let h = 1779033703 ^ seedInput.length;
  for (let i = 0; i < seedInput.length; i += 1) {
    h = Math.imul(h ^ seedInput.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }

  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

export function clone(value) {
  return structuredClone(value);
}

export function shuffle(items, rng = Math.random) {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function randomInt(maxExclusive, rng = Math.random) {
  return Math.floor(rng() * maxExclusive);
}

export function ensureResourceBag(bag = {}) {
  const full = {};
  for (const resource of RESOURCES) {
    full[resource] = Number.isFinite(bag[resource]) ? bag[resource] : 0;
  }
  return full;
}

export function bagAtLeast(bag, cost) {
  return Object.entries(cost).every(([resource, amount]) => (bag[resource] ?? 0) >= amount);
}

export function bagAddInPlace(target, delta) {
  for (const [resource, amount] of Object.entries(delta)) {
    target[resource] = (target[resource] ?? 0) + amount;
  }
}

export function bagSubtractInPlace(target, delta) {
  for (const [resource, amount] of Object.entries(delta)) {
    target[resource] = (target[resource] ?? 0) - amount;
  }
}

export function bagCount(bag) {
  return Object.values(bag).reduce((sum, value) => sum + value, 0);
}

export function compactBag(bag) {
  const out = {};
  for (const resource of RESOURCES) {
    const value = bag[resource] ?? 0;
    if (value > 0) {
      out[resource] = value;
    }
  }
  return out;
}

export function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export function nowIso(ts = Date.now()) {
  return new Date(ts).toISOString();
}

export function makeId(prefix, rng = Math.random) {
  return `${prefix}_${Math.floor(rng() * 1e9).toString(36)}_${Date.now().toString(36)}`;
}
