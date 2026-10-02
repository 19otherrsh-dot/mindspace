import { computeLongestStreak, computeStreak } from './dates.ts';
import { RESTS_PER_MONTH, remainingForMonth } from '../services/streak.ts';

/**
 * Streak insurance is the mechanic most likely to be quietly wrong: it decides
 * whether months of practice survive one bad day, and every branch is a date
 * calculation. These cover the shape of the rule rather than the plumbing.
 */

describe('computeStreak', () => {
  const today = '2026-08-14';

  it('counts consecutive days ending today', () => {
    expect(computeStreak(['2026-08-14', '2026-08-13', '2026-08-12'], today)).toBe(3);
  });

  it('keeps the streak alive until the day is actually over', () => {
    // Practised yesterday, nothing yet today — the run stands rather than
    // resetting at midnight.
    expect(computeStreak(['2026-08-13', '2026-08-12'], today)).toBe(2);
  });

  it('is broken by a two-day absence', () => {
    expect(computeStreak(['2026-08-12', '2026-08-11'], today)).toBe(0);
  });

  it('returns zero with no history', () => {
    expect(computeStreak([], today)).toBe(0);
  });

  describe('with a rest day', () => {
    it('bridges a single missed day', () => {
      // Practised today and the day before yesterday; yesterday forgiven.
      const streak = computeStreak(
        ['2026-08-14', '2026-08-12', '2026-08-11'],
        today,
        ['2026-08-13'],
      );
      expect(streak).toBe(4);
    });

    it('still breaks when two days in a row are missed', () => {
      // Only one of the two gap days is forgiven, so the run cannot span it.
      const streak = computeStreak(
        ['2026-08-14', '2026-08-10'],
        today,
        ['2026-08-13'],
      );
      expect(streak).toBe(2);
    });

    it('does not invent a streak from an unrelated forgiven day', () => {
      const streak = computeStreak(['2026-08-14'], today, ['2026-06-02']);
      expect(streak).toBe(1);
    });
  });
});

describe('computeLongestStreak', () => {
  it('finds the best run anywhere in history', () => {
    const dates = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-03-10', '2026-03-11'];
    expect(computeLongestStreak(dates)).toBe(3);
  });

  it('counts a forgiven day as part of the run', () => {
    // Without the rest day this is two runs of two; with it, one run of five.
    const dates = ['2026-01-01', '2026-01-02', '2026-01-04', '2026-01-05'];
    expect(computeLongestStreak(dates)).toBe(2);
    expect(computeLongestStreak(dates, ['2026-01-03'])).toBe(5);
  });
});

describe('remainingForMonth', () => {
  it('starts the month with the full allowance', () => {
    expect(remainingForMonth([], '2026-08-14')).toBe(RESTS_PER_MONTH);
  });

  it('is spent by a rest day in the same month', () => {
    expect(remainingForMonth(['2026-08-03'], '2026-08-14')).toBe(RESTS_PER_MONTH - 1);
  });

  it('is not spent by a rest day in another month', () => {
    // The allowance refreshes monthly, so July's rest day does not limit August.
    expect(remainingForMonth(['2026-07-30'], '2026-08-14')).toBe(RESTS_PER_MONTH);
  });

  it('never reports a negative balance', () => {
    const manySpends = ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04'];
    expect(remainingForMonth(manySpends, '2026-08-14')).toBe(0);
  });

  it('budgets against the month of the missed day, not today', () => {
    // Returning on 1 August after missing 31 July draws on July's allowance,
    // so a fresh month does not hand out a second rest day for the same gap.
    expect(remainingForMonth(['2026-07-15'], '2026-07-31')).toBe(RESTS_PER_MONTH - 1);
  });
});
