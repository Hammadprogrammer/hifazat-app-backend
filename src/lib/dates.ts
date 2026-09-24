export function getTodayDate(): string {
  return new Date().toISOString().split('T')[0]!;
}

export function subtractDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().split('T')[0]!;
}

/** Count consecutive days ending today from a list of date strings */
export function computeStreak(dates: string[], today: string = getTodayDate()): number {
  const unique = [...new Set(dates)].sort().reverse();
  let streak = 0;
  let expected = today;
  for (const d of unique) {
    if (d === expected) {
      streak++;
      expected = subtractDays(expected, 1);
    } else if (d < expected) {
      break;
    }
  }
  return streak;
}
