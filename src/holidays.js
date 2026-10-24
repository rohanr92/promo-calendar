// US retail calendar (+ UK dates that matter for Debenhams), computed for any year.
// weight: 'major' = big selling moment, 'minor' = good to know

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const D = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const addDays = (date, n) => new Date(date.getTime() + n * 864e5);

// nth weekday of month (weekday 0=Sun..6=Sat, n=1..5)
function nthWeekday(y, m, weekday, n) {
  const first = D(y, m, 1);
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return D(y, m, 1 + offset + (n - 1) * 7);
}
function lastWeekday(y, m, weekday) {
  const last = D(y, m + 1, 0);
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  return addDays(last, -offset);
}
function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return D(y, month, day);
}

function holidaysForYear(y) {
  const thanksgiving = nthWeekday(y, 11, 4, 4);
  const christmas = D(y, 12, 25);
  const superSaturday = addDays(christmas, -(((christmas.getUTCDay() - 6 + 7) % 7) || 7));
  const e = easter(y);

  const list = [
    ["New Year's Day", D(y, 1, 1), 'major', 'US'],
    ['Martin Luther King Jr. Day', nthWeekday(y, 1, 1, 3), 'minor', 'US'],
    ["Valentine's Day", D(y, 2, 14), 'major', 'US'],
    ["Presidents' Day", nthWeekday(y, 2, 1, 3), 'major', 'US'],
    ["International Women's Day", D(y, 3, 8), 'minor', 'Global'],
    ["St. Patrick's Day", D(y, 3, 17), 'minor', 'US'],
    ['Mothering Sunday (UK)', addDays(e, -21), 'major', 'UK'],
    ['Easter', e, 'minor', 'US'],
    ['Earth Day', D(y, 4, 22), 'minor', 'Global'],
    ['Cinco de Mayo', D(y, 5, 5), 'minor', 'US'],
    ["Mother's Day", nthWeekday(y, 5, 0, 2), 'major', 'US'],
    ['Memorial Day', lastWeekday(y, 5, 1), 'major', 'US'],
    ["Father's Day", nthWeekday(y, 6, 0, 3), 'minor', 'US'],
    ['Juneteenth', D(y, 6, 19), 'minor', 'US'],
    ['Independence Day', D(y, 7, 4), 'major', 'US'],
    ['Labor Day', nthWeekday(y, 9, 1, 1), 'major', 'US'],
    ["Indigenous Peoples' / Columbus Day", nthWeekday(y, 10, 1, 2), 'minor', 'US'],
    ['Halloween', D(y, 10, 31), 'minor', 'US'],
    ["Veterans Day / Singles' Day", D(y, 11, 11), 'minor', 'US'],
    ['Thanksgiving', thanksgiving, 'major', 'US'],
    ['Black Friday', addDays(thanksgiving, 1), 'major', 'US'],
    ['Small Business Saturday', addDays(thanksgiving, 2), 'minor', 'US'],
    ['Cyber Monday', addDays(thanksgiving, 4), 'major', 'US'],
    ['Giving Tuesday', addDays(thanksgiving, 5), 'minor', 'US'],
    ['Green Monday', nthWeekday(y, 12, 1, 2), 'minor', 'US'],
    ['Super Saturday', superSaturday, 'major', 'US'],
    ['Christmas Eve', D(y, 12, 24), 'minor', 'US'],
    ['Christmas Day', christmas, 'major', 'US'],
    ['Boxing Day (UK)', D(y, 12, 26), 'major', 'UK'],
    ["New Year's Eve", D(y, 12, 31), 'minor', 'US']
  ];

  const out = list.map(([title, date, weight, region]) => {
    const d = ymd(date);
    return { id: `h-${d}-${title.replace(/\W+/g, '').toLowerCase()}`, title, start_date: d, end_date: d, weight, region, type: 'holiday' };
  });

  // Multi-day selling windows
  out.push({
    id: `h-${y}-cyberweek`, title: 'Cyber Week (Thanksgiving → Cyber Monday)', type: 'holiday', weight: 'season', region: 'US',
    start_date: ymd(thanksgiving), end_date: ymd(addDays(thanksgiving, 4))
  });
  out.push({
    id: `h-${y}-holidayseason`, title: 'Holiday shopping season', type: 'holiday', weight: 'season', region: 'US',
    start_date: ymd(addDays(thanksgiving, 1)), end_date: ymd(christmas)
  });
  return out;
}

// All holidays overlapping [from, to] (YYYY-MM-DD)
function holidaysBetween(from, to) {
  const y1 = Number(from.slice(0, 4)), y2 = Number(to.slice(0, 4));
  const all = [];
  for (let y = y1; y <= y2; y++) all.push(...holidaysForYear(y));
  return all.filter(h => h.end_date >= from && h.start_date <= to);
}

module.exports = { holidaysBetween, holidaysForYear };
