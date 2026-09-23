/**
 * Human-facing date formatting (project/conventions.md §Time — formatting
 * lives in the app; the DB keeps ISO-8601 UTC strings). Device-local by
 * design: a list row shows the day the user lives in, not UTC.
 */
export function formatLocalDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    // Not a parseable timestamp — show the stored value rather than a lie.
    return iso;
  }
  return date.toLocaleDateString();
}

/** Device-local "date + HH:mm" (calendar startsAt, deadlines, reminders). */
export function formatLocalDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return `${date.toLocaleDateString()} ${time}`;
}
