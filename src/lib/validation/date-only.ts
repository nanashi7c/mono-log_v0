type DateOnlyValidationError = Readonly<{ ok: false; error: string }>;

export type DateOnlyValidationResult =
  | Readonly<{ ok: true; value: string | null }>
  | DateOnlyValidationError;

type DateOnlyOptions = Readonly<{
  label: string;
}>;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  const days = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return days[month - 1] ?? 0;
}

function dateOnlyError(options: DateOnlyOptions): DateOnlyValidationError {
  return {
    ok: false,
    error: `${options.label} must be YYYY-MM-DD or null`,
  };
}

export function parseOptionalDateOnly(
  value: unknown,
  options: DateOnlyOptions,
): DateOnlyValidationResult {
  if (value == null) return { ok: true, value: null };
  if (typeof value !== "string") return dateOnlyError(options);

  const normalized = value.trim();
  if (normalized === "") return { ok: true, value: null };

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) return dateOnlyError(options);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month)
  ) {
    return dateOnlyError(options);
  }

  return { ok: true, value: normalized };
}
