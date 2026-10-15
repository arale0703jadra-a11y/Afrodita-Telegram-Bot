export type GroupAdminCheck =
  | { status: "administrator" }
  | { status: "not_administrator" }
  | { status: "unavailable"; error: unknown };

interface ChatMemberLookup {
  getChatMember(
    chatId: number | string,
    userId: number,
  ): Promise<{ status: string }>;
}

export async function checkGroupAdministrator(
  api: ChatMemberLookup,
  chatId: number,
  userId: number,
): Promise<GroupAdminCheck> {
  if (
    !Number.isSafeInteger(chatId) ||
    chatId === 0 ||
    !Number.isSafeInteger(userId) ||
    userId <= 0
  ) {
    return { status: "not_administrator" };
  }
  try {
    const member = await api.getChatMember(chatId, userId);
    return member.status === "administrator" || member.status === "creator"
      ? { status: "administrator" }
      : { status: "not_administrator" };
  } catch (error) {
    return { status: "unavailable", error };
  }
}
