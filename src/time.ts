export function localDateTime(
  timestamp: number,
  timeZone: string,
): { date: string; time: string; hourKey: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(timestamp);
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  const date = `${values.year}-${values.month}-${values.day}`;
  const hour = values.hour;
  return {
    date,
    time: `${hour}:${values.minute}`,
    hourKey: `${date}T${hour}`,
  };
}
