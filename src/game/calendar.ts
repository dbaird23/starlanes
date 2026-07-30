/**
 * EV Nova keeps a real calendar — the status screen reads "July 8th, 1177 NC".
 * The game stores elapsed days; this turns that into a date crön resources can
 * be compared against.
 */

/*
 * The campaign's epoch and the way a date is written both come from the chär
 * template — Nova's own ".Trader" starts on 23 June 1177 and hangs " NC" off
 * every date it prints. These are defaults for before galaxy.json loads;
 * setCalendar replaces them.
 */
export let START_YEAR = 1177;
export let START_MONTH = 6;
export let START_DAY = 23;
let datePrefix = "";
let dateSuffix = " NC";

export function setCalendar(t: {
  startDay: number;
  startMonth: number;
  startYear: number;
  datePrefix: string;
  dateSuffix: string;
}): void {
  if (t.startYear > 0) START_YEAR = t.startYear;
  if (t.startMonth >= 1 && t.startMonth <= 12) START_MONTH = t.startMonth;
  if (t.startDay >= 1 && t.startDay <= 31) START_DAY = t.startDay;
  datePrefix = t.datePrefix ?? "";
  dateSuffix = t.dateSuffix ?? "";
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export interface GameDate {
  day: number;
  month: number;
  year: number;
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(month: number, year: number): number {
  return month === 2 && isLeap(year) ? 29 : MONTH_DAYS[month - 1];
}

/** Convert elapsed days since the campaign start into a calendar date. */
export function dateFromDays(elapsed: number): GameDate {
  let day = START_DAY + Math.floor(elapsed);
  let month = START_MONTH;
  let year = START_YEAR;
  for (;;) {
    const len = daysInMonth(month, year);
    if (day <= len) break;
    day -= len;
    month++;
    if (month > 12) {
      month = 1;
      year++;
    }
  }
  return { day, month, year };
}

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

/** "June 23rd, 1177 NC" — prefix and suffix as the chär template gives them. */
export function formatDate(elapsed: number): string {
  const d = dateFromDays(elapsed);
  return `${datePrefix}${MONTH_NAMES[d.month - 1]} ${ordinal(d.day)}, ${d.year}${dateSuffix}`;
}

/** Short form for the status bar. */
export function formatDateShort(elapsed: number): string {
  const d = dateFromDays(elapsed);
  return `${MONTH_NAMES[d.month - 1].slice(0, 3)} ${d.day}, ${d.year}`;
}

/**
 * Is a date within a crön's window? Any field set to 0 or -1 is ignored, so a
 * cron with only FirstYear runs from that year onward.
 */
export function withinWindow(
  date: GameDate,
  first: { day: number; month: number; year: number },
  last: { day: number; month: number; year: number },
): boolean {
  const after = (bound: { day: number; month: number; year: number }): boolean => {
    if (bound.year > 0 && date.year !== bound.year) return date.year > bound.year;
    if (bound.month > 0 && date.month !== bound.month) return date.month > bound.month;
    if (bound.day > 0) return date.day >= bound.day;
    return true;
  };
  const before = (bound: { day: number; month: number; year: number }): boolean => {
    if (bound.year > 0 && date.year !== bound.year) return date.year < bound.year;
    if (bound.month > 0 && date.month !== bound.month) return date.month < bound.month;
    if (bound.day > 0) return date.day <= bound.day;
    return true;
  };
  return after(first) && before(last);
}
