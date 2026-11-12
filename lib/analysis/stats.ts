// lib/analysis/stats.ts
// Small, dependency free statistics helpers.

const LANCZOS = [
  676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

export function logGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = 0.99999999999980993;
  const t = x + 7.5;
  for (let i = 0; i < LANCZOS.length; i++) a += LANCZOS[i] / (x + i + 1);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function logChoose(n: number, k: number): number {
  return logGamma(n + 1) - logGamma(k + 1) - logGamma(n - k + 1);
}

/** P(X >= k) for X ~ Binomial(n, p). */
export function binomialUpperTail(k: number, n: number, p: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const lp = Math.log(p);
  const lq = Math.log(1 - p);
  let sum = 0;
  for (let i = k; i <= n; i++) {
    sum += Math.exp(logChoose(n, i) + i * lp + (n - i) * lq);
  }
  return Math.min(1, sum);
}

/**
 * P(X >= k) where X is a sum of independent Bernoulli trials with the given probabilities
 * (Poisson binomial). Exact dynamic programming, O(n * k), with k as an absorbing state.
 */
export function poissonBinomialUpperTail(probs: number[], k: number): number {
  if (k <= 0) return 1;
  if (k > probs.length) return 0;
  const dist = new Float64Array(k + 1);
  dist[0] = 1;
  for (const raw of probs) {
    const p = Math.min(1, Math.max(0, raw));
    if (p === 0) continue;
    dist[k] += dist[k - 1] * p;
    for (let j = k - 1; j >= 1; j--) dist[j] = dist[j] * (1 - p) + dist[j - 1] * p;
    dist[0] *= 1 - p;
  }
  return Math.min(1, Math.max(0, dist[k]));
}

/**
 * P(X >= k) where X is a sum of independent counts that can each be more than 1. dists[i][j] is the
 * chance that count i equals j. With only 0 or 1 counts this is the Poisson binomial above. Exact
 * dynamic programming, O(n * k * size), with k as an absorbing state.
 */
export function clusteredUpperTail(dists: ArrayLike<number>[], k: number): number {
  if (k <= 0) return 1;
  let cur = new Float64Array(k + 1);
  let next = new Float64Array(k + 1);
  cur[0] = 1;
  for (const d of dists) {
    next.fill(0);
    next[k] = cur[k];
    for (let j = 0; j < k; j++) {
      const pj = cur[j];
      if (pj === 0) continue;
      for (let c = 0; c < d.length; c++) {
        const q = d[c];
        if (q > 0) next[Math.min(k, j + c)] += pj * q;
      }
    }
    [cur, next] = [next, cur];
  }
  return Math.min(1, Math.max(0, cur[k]));
}

/** Benjamini–Hochberg adjusted p values (q values), same order as input. */
export function benjaminiHochberg(pValues: number[]): number[] {
  const m = pValues.length;
  if (!m) return [];
  const order = pValues.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const q = new Array<number>(m);
  let prev = 1;
  for (let r = m - 1; r >= 0; r--) {
    const val = Math.min(prev, (order[r].p * m) / (r + 1));
    q[order[r].i] = val;
    prev = val;
  }
  return q;
}

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
