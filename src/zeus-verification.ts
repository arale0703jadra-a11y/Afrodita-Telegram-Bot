import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export type ZeusVerificationStatus =
  | { status: "verified" | "not_verified" }
  | { status: "unavailable"; reason: "missing" | "invalid" | "read_error" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readZeusVerification(
  storageDirectory: string,
  chatId: number,
  userId: number,
): Promise<ZeusVerificationStatus> {
  if (
    !Number.isSafeInteger(chatId) ||
    chatId === 0 ||
    !Number.isSafeInteger(userId) ||
    userId <= 0
  ) {
    return { status: "unavailable", reason: "invalid" };
  }
  let raw: string;
  try {
    raw = await readFile(resolve(storageDirectory, `${chatId}.json`), "utf8");
  } catch (error) {
    return {
      status: "unavailable",
      reason:
        error instanceof Error && "code" in error && error.code === "ENOENT"
          ? "missing"
          : "read_error",
    };
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      !isRecord(parsed.promotion) ||
      !isRecord(parsed.promotion.verifiedUsers)
    ) {
      return { status: "unavailable", reason: "invalid" };
    }
    return parsed.promotion.verifiedUsers[String(userId)] === true
      ? { status: "verified" }
      : { status: "not_verified" };
  } catch {
    return { status: "unavailable", reason: "invalid" };
  }
}
