export const MIN_SCHEDULED_POLL_INTERVAL_MS = 90 * 60_000;
export const MAX_SCHEDULED_POLL_INTERVAL_MS = 120 * 60_000;
export const MAX_SCHEDULED_POLL_LATE_MS = 2 * 60_000;

export function scheduledPollIntervalMs(randomValue = Math.random()): number {
  const bounded = Number.isFinite(randomValue)
    ? Math.min(1, Math.max(0, randomValue))
    : 0.5;
  return Math.round(
    MIN_SCHEDULED_POLL_INTERVAL_MS +
      bounded *
        (MAX_SCHEDULED_POLL_INTERVAL_MS - MIN_SCHEDULED_POLL_INTERVAL_MS),
  );
}

export function isWithinScheduledPollWindow(
  time: string,
  scheduleTimes: readonly string[],
): boolean {
  const configuredMinutes = configuredWindow(scheduleTimes);
  if (configuredMinutes.length === 0) return false;
  const [hour, minute] = time.split(":").map(Number);
  if (hour === undefined || minute === undefined) return false;
  const nowMinute = hour * 60 + minute;
  const start = configuredMinutes[0]!;
  const end = configuredMinutes[configuredMinutes.length - 1]!;
  return start <= end
    ? nowMinute >= start && nowMinute <= end
    : nowMinute >= start || nowMinute <= end;
}

export function nextScheduledPollWindowTime(
  timestamp: number,
  timeZone: string,
  scheduleTimes: readonly string[],
): number | undefined {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return undefined;
  const configuredMinutes = configuredWindow(scheduleTimes);
  if (configuredMinutes.length === 0) return undefined;
  const startTime = Math.ceil(timestamp / 60_000) * 60_000;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const localParts = localDateParts(formatter, startTime);
  if (!localParts) return undefined;
  const localMinute = Number(localParts.hour) * 60 + Number(localParts.minute);
  const [windowStart, windowEnd] = configuredMinutes;
  if (localMinute >= windowStart! && localMinute <= windowEnd!) return startTime;

  const desiredDate = localMinute < windowStart!
    ? localParts
    : shiftLocalDate(localParts, 1);
  return localDateTimeToEpoch(
    desiredDate,
    windowStart!,
    formatter,
  );
}

interface LocalDateParts {
  year: number;
  month: number;
  day: number;
  hour: string;
  minute: string;
}

function configuredWindow(scheduleTimes: readonly string[]): number[] {
  return scheduleTimes
    .filter((value) => /^([01]\d|2[0-3]):[0-5]\d$/u.test(value))
    .map((value) => {
      const [hour, minute] = value.split(":").map(Number);
      return hour! * 60 + minute!;
    })
    .sort((left, right) => left - right);
}

function localDateParts(
  formatter: Intl.DateTimeFormat,
  timestamp: number,
): LocalDateParts | undefined {
  const parts = formatter.formatToParts(timestamp);
  const value = (type: string): string | undefined =>
    parts.find((part) => part.type === type)?.value;
  const year = value("year");
  const month = value("month");
  const day = value("day");
  const hour = value("hour");
  const minute = value("minute");
  if (
    !year || !month || !day || !hour || !minute ||
    ![year, month, day, hour, minute].every((part) => /^\d+$/u.test(part))
  ) return undefined;
  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    hour,
    minute,
  };
}

function shiftLocalDate(parts: LocalDateParts, days: number): LocalDateParts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    ...parts,
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

function localDateTimeToEpoch(
  date: LocalDateParts,
  minuteOfDay: number,
  formatter: Intl.DateTimeFormat,
): number | undefined {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const desiredAsUtc = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    hour,
    minute,
  );
  let guess = desiredAsUtc;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const observed = localDateParts(formatter, guess);
    if (!observed) return undefined;
    const observedAsUtc = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      Number(observed.hour),
      Number(observed.minute),
    );
    const difference = observedAsUtc - guess;
    if (difference === 0) return guess;
    guess -= difference;
  }
  const result = localDateParts(formatter, guess);
  return result &&
      result.year === date.year &&
      result.month === date.month &&
      result.day === date.day &&
      Number(result.hour) === hour &&
      Number(result.minute) === minute
    ? guess
    : undefined;
}
