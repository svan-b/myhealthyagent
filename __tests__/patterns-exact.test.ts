/** @jest-environment node */
import {
  fisherExactTwoSided,
  hypergeometricPmf,
  hypergeometricUpperTail,
  logChoose,
  permutationTestTwoSided,
} from '@/lib/analysis/exact';

// Deterministic PRNG so tests are stable
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const choose = (n: number, k: number) => {
  let c = 1;
  for (let i = 1; i <= k; i++) c = (c * (n - k + i)) / i;
  return c;
};

/** Every way of splitting the values into the two groups, counted directly. */
function bruteForcePermutation(a: number[], b: number[]): number {
  const all = [...a, ...b];
  const k = a.length;
  const sum = (xs: number[]) => xs.reduce((s, v) => s + v, 0);
  const diff = (xs: number[], ys: number[]) => sum(xs) / xs.length - sum(ys) / ys.length;
  const observed = Math.abs(diff(a, b));
  let hits = 0;
  let total = 0;
  const walk = (i: number, picked: number[]) => {
    if (picked.length === k) {
      const ys = all.filter((_, j) => !picked.includes(j));
      total++;
      if (
        Math.abs(
          diff(
            picked.map(j => all[j]),
            ys,
          ),
        ) >=
        observed - 1e-9
      )
        hits++;
      return;
    }
    if (i >= all.length) return;
    walk(i + 1, [...picked, i]);
    walk(i + 1, picked);
  };
  walk(0, []);
  return hits / total;
}

describe('exact tests', () => {
  it('logChoose matches small binomial coefficients', () => {
    expect(Math.exp(logChoose(5, 2))).toBeCloseTo(10, 9);
    expect(Math.exp(logChoose(60, 10)) / choose(60, 10)).toBeCloseTo(1, 10);
    expect(logChoose(4, 5)).toBe(-Infinity);
  });

  it('hypergeometric probabilities add up to 1 and the tail matches a direct count', () => {
    let total = 0;
    for (let k = 0; k <= 10; k++) total += hypergeometricPmf(k, 60, 50, 10);
    expect(total).toBeCloseTo(1, 12);
    // 2 marked in 3 draws from 10 items with 4 marked: (C(4,2) C(6,1) + C(4,3)) / C(10,3)
    expect(hypergeometricUpperTail(2, 10, 4, 3)).toBeCloseTo((6 * 6 + 4) / 120, 12);
    expect(hypergeometricUpperTail(0, 10, 4, 3)).toBeCloseTo(1, 12);
    expect(hypergeometricUpperTail(4, 10, 4, 3)).toBe(0);
  });

  it('Fisher exact test matches published values', () => {
    // Lady tasting tea, and an example from R's fisher.test documentation
    expect(fisherExactTwoSided(3, 1, 1, 3)).toBeCloseTo(0.4857, 4);
    expect(fisherExactTwoSided(1, 11, 9, 3)).toBeCloseTo(0.002759, 6);
    // The weekday example from the review: 3 of 4 weekend days against 4 of 10 weekdays
    expect(fisherExactTwoSided(3, 1, 4, 6)).toBeCloseTo(0.5594, 4);
    expect(fisherExactTwoSided(4, 0, 1, 9)).toBeCloseTo(0.004995, 5);
    expect(fisherExactTwoSided(0, 0, 0, 0)).toBe(1);
  });

  it('Fisher exact test does not depend on how the table is turned', () => {
    const r = rng(3);
    for (let i = 0; i < 200; i++) {
      const [a, b, c, d] = [0, 0, 0, 0].map(() => Math.floor(r() * 15));
      const p = fisherExactTwoSided(a, b, c, d);
      expect(fisherExactTwoSided(c, d, a, b)).toBeCloseTo(p, 10);
      expect(fisherExactTwoSided(a, c, b, d)).toBeCloseTo(p, 10);
      expect(fisherExactTwoSided(b, a, d, c)).toBeCloseTo(p, 10);
    }
  });

  it('permutation test matches counting every split, with ties', () => {
    expect(permutationTestTwoSided([1, 1], [0, 0])).toBeCloseTo(1 / 3, 12);
    expect(permutationTestTwoSided([9, 9, 9, 9, 9], [2, 2, 2, 2, 2])).toBeCloseTo(2 / 252, 12);
    expect(permutationTestTwoSided([5, 5, 5], [5, 5, 5])).toBe(1);
    expect(permutationTestTwoSided([], [2, 5])).toBe(1);
    expect(permutationTestTwoSided([9, NaN, 9], [2, 2, 2])).toBe(1);
    const r = rng(11);
    const levels = [1, 2, 5, 7, 9, 10];
    for (let i = 0; i < 150; i++) {
      const a = Array.from({ length: 1 + Math.floor(r() * 7) }, () => levels[Math.floor(r() * 4) + 1]);
      const b = Array.from({ length: 1 + Math.floor(r() * 7) }, () => levels[Math.floor(r() * levels.length)]);
      expect(permutationTestTwoSided(a, b)).toBeCloseTo(bruteForcePermutation(a, b), 10);
    }
  });

  it('permutation test is quick for two weeks of daily ratings', () => {
    const a = Array.from({ length: 14 }, (_, i) => [2, 5, 7, 9][i % 4]);
    const b = Array.from({ length: 14 }, (_, i) => [9, 7, 5, 2, 2][i % 5]);
    const start = Date.now();
    for (let i = 0; i < 100; i++) permutationTestTwoSided(a, b);
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
