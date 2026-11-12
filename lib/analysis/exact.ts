// lib/analysis/exact.ts
// Exact tests for the small counts in a personal diary. They use no random sampling and no
// approximations, so the same logs always give the same answer.
import { logGamma } from './stats';

/** Natural log of "n choose k". */
export function logChoose(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

/**
 * Chance of exactly k marked items when `draws` items are picked at random, without putting any
 * back, from `population` items of which `marked` are marked (the hypergeometric distribution).
 */
export function hypergeometricPmf(k: number, population: number, marked: number, draws: number): number {
  if (k < Math.max(0, draws - (population - marked)) || k > Math.min(draws, marked)) return 0;
  return Math.exp(logChoose(marked, k) + logChoose(population - marked, draws - k) - logChoose(population, draws));
}

/**
 * Chance of k or more marked items in the same setting. This is the one sided Fisher exact test:
 * how surprising an overlap of k would be if the two groups had nothing to do with each other.
 */
export function hypergeometricUpperTail(k: number, population: number, marked: number, draws: number): number {
  const lo = Math.max(k, 0, draws - (population - marked));
  const hi = Math.min(draws, marked);
  let sum = 0;
  for (let x = lo; x <= hi; x++) sum += hypergeometricPmf(x, population, marked, draws);
  return Math.min(1, sum);
}

/**
 * Two sided Fisher exact test for the 2x2 table
 *
 *   a  b
 *   c  d
 *
 * It adds up the chance of every table with the same row and column totals that is no more likely
 * than the observed one, which is the usual definition (R's fisher.test does the same).
 */
export function fisherExactTwoSided(a: number, b: number, c: number, d: number): number {
  const population = a + b + c + d;
  const marked = a + c;
  const draws = a + b;
  const lo = Math.max(0, draws - (population - marked));
  const hi = Math.min(draws, marked);
  const observed = hypergeometricPmf(a, population, marked, draws);
  let sum = 0;
  for (let x = lo; x <= hi; x++) {
    const p = hypergeometricPmf(x, population, marked, draws);
    // The small allowance keeps tables that tie with the observed one despite rounding.
    if (p <= observed * (1 + 1e-7)) sum += p;
  }
  return Math.min(1, sum);
}

/**
 * Two sided exact permutation test for a difference in means between two groups of whole numbers,
 * such as severity ratings. It gives the chance that splitting all the values into groups of the
 * same sizes at random would make the means differ at least as much as they do. Tied values are
 * handled exactly. Values are rounded to whole numbers first. The work grows with the number of
 * values times the size of their sum, which is tiny for a few weeks of daily ratings.
 */
export function permutationTestTwoSided(groupA: number[], groupB: number[]): number {
  const all = [...groupA, ...groupB].map(v => Math.round(v));
  const n = all.length;
  const k = groupA.length;
  if (k === 0 || k === n || !all.every(Number.isFinite)) return 1;
  const min = Math.min(...all);
  const values = all.map(v => v - min);
  const maxSum = [...values]
    .sort((x, y) => y - x)
    .slice(0, k)
    .reduce((s, v) => s + v, 0);

  // dist[j][s] is the chance that, among the values looked at so far, j went to group A and they
  // add up to s. Each value joins group A with the chance that a random split would give it.
  const dist = Array.from({ length: k + 1 }, () => new Float64Array(maxSum + 1));
  dist[0][0] = 1;
  values.forEach((v, i) => {
    for (let j = Math.min(i, k - 1); j >= 0; j--) {
      const take = (k - j) / (n - i);
      const row = dist[j];
      const next = dist[j + 1];
      for (let s = 0; s + v <= maxSum; s++) if (row[s]) next[s + v] += row[s] * take;
      for (let s = 0; s <= maxSum; s++) row[s] *= 1 - take;
    }
  });

  const observed = groupA.reduce((s, v) => s + Math.round(v) - min, 0);
  const expected = (k * values.reduce((s, v) => s + v, 0)) / n;
  const gap = Math.abs(observed - expected) - 1e-9;
  let p = 0;
  dist[k].forEach((q, s) => {
    if (Math.abs(s - expected) >= gap) p += q;
  });
  return Math.min(1, p);
}
