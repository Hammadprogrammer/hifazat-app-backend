"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTodayDate = getTodayDate;
exports.subtractDays = subtractDays;
exports.computeStreak = computeStreak;
function getTodayDate() {
    return new Date().toISOString().split('T')[0];
}
function subtractDays(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().split('T')[0];
}
/** Count consecutive days ending today from a list of date strings */
function computeStreak(dates, today = getTodayDate()) {
    const unique = [...new Set(dates)].sort().reverse();
    let streak = 0;
    let expected = today;
    for (const d of unique) {
        if (d === expected) {
            streak++;
            expected = subtractDays(expected, 1);
        }
        else if (d < expected) {
            break;
        }
    }
    return streak;
}
