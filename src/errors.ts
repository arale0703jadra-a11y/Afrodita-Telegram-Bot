function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function safeErrorSummary(error: unknown): string {
  if (
    isRecord(error) &&
    typeof error.error_code === "number" &&
    Number.isSafeInteger(error.error_code)
  ) {
    if (
      error.error_code === 429 &&
      isRecord(error.parameters) &&
      typeof error.parameters.retry_after === "number" &&
      Number.isFinite(error.parameters.retry_after)
    ) {
      return `Telegram API HTTP 429; retry_after=${Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.floor(error.parameters.retry_after)))}s`;
    }
    return `Telegram API HTTP ${error.error_code}`;
  }
  return safeErrorType(error);
}

export function safeErrorType(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  return /^[A-Za-z][A-Za-z0-9]{0,47}$/.test(name) ? name : "unknown";
}
