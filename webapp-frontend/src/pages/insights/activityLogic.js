// Pure helpers for the Insights "Project teams" and "Recent activity" cards.

const TZ = 'Asia/Singapore';
const part = (iso, opts) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...opts }).format(new Date(iso));

export function activityTitle(item) {
  if (item.kind === 'check_in') return 'Checked in';
  return item.ended && item.ended !== 'checked out' ? `Checked out (${item.ended})` : 'Checked out';
}

export const activityPlace = (item) => [item.seat_label, item.plan_name, item.zone].filter(Boolean).join(' · ');

/** "Today 09:00", or "Thu 15 Oct 17:46" for another day (Singapore time). */
export function activityWhen(iso, todayIso) {
  const time = part(iso, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const day = part(iso, { year: 'numeric', month: '2-digit', day: '2-digit' }).split('/').reverse().join('-');
  if (day === todayIso) return `Today ${time}`;
  return `${part(iso, { weekday: 'short' })} ${part(iso, { day: 'numeric', month: 'short' })} ${time}`;
}
