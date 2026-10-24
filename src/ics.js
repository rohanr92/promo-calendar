// iCalendar feed so anyone can subscribe from Google Calendar (Other calendars > From URL)
const { db } = require('./db');
const { holidaysBetween } = require('./holidays');

const esc = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const compact = d => d.replace(/-/g, '');
const nextDay = d => new Date(Date.parse(d + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10);

function fold(line) {
  const out = [];
  while (line.length > 74) { out.push(line.slice(0, 74)); line = ' ' + line.slice(74); }
  out.push(line);
  return out.join('\r\n');
}

const PART = { invited: 'Invited', considering: 'Considering', joined: 'Joined', declined: 'Declined', not_joined: 'Not joined' };

function buildIcs() {
  const today = new Date();
  const from = new Date(today.getTime() - 90 * 864e5).toISOString().slice(0, 10);
  const to = new Date(today.getTime() + 400 * 864e5).toISOString().slice(0, 10);
  const stamp = today.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

  const events = db.prepare(`SELECT e.*, c.name AS channel_name FROM events e LEFT JOIN channels c ON c.id = e.channel_id
    WHERE e.end_date >= ? AND e.start_date <= ?`).all(from, to);

  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Menina Step//Promo Calendar//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:Menina Promo Calendar', 'X-WR-TIMEZONE:America/New_York'];

  for (const e of events) {
    const prefix = e.channel_name ? `[${e.channel_name}] ` : '';
    const status = e.participation ? ` (${PART[e.participation] || e.participation})` : '';
    const desc = [e.discount_label, e.promo_code && `Code: ${e.promo_code}`, e.description, e.link, e.owner && `Owner: ${e.owner}`,
      e.newsletter_status && `Newsletter: ${e.newsletter_status}`].filter(Boolean).join('\n');
    lines.push('BEGIN:VEVENT', `UID:event-${e.id}@promo-calendar`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(e.start_date)}`, `DTEND;VALUE=DATE:${compact(nextDay(e.end_date))}`,
      fold(`SUMMARY:${esc(prefix + e.title + status)}`), fold(`DESCRIPTION:${esc(desc)}`), 'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  for (const h of holidaysBetween(from, to)) {
    if (h.weight === 'season') continue;
    lines.push('BEGIN:VEVENT', `UID:${h.id}@promo-calendar`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(h.start_date)}`, `DTEND;VALUE=DATE:${compact(nextDay(h.end_date))}`,
      fold(`SUMMARY:${esc(h.title)}`), 'TRANSP:TRANSPARENT', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

module.exports = { buildIcs };
