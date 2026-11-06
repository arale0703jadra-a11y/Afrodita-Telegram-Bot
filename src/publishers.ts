import type { Api } from "grammy";
import type { AfroditaConfig } from "./config.js";
import {
  entertainmentLineReply,
  scheduledPollContent,
} from "./messages.js";
import {
  MAX_SCHEDULED_POLL_INTERVAL_MS,
  nextScheduledPollWindowTime,
  scheduledPollIntervalMs,
} from "./poll-schedule.js";
import { seasonalPollForDate } from "./seasonal-campaigns.js";
import { localDateTime } from "./time.js";
import {
  classifyPublicationFailure,
  finalizePublication,
  reservePublication,
  recordPromotedProfile,
  type PublicationOutcome,
  type PublicationTrigger,
} from "./publications.js";
import type { AfroditaStore } from "./store.js";
import type { AfroditaTopic, ContentPermission, PublicationCategory } from "./types.js";
import { getActiveVerifiedModels } from "./verified-users.js";

export interface PollPublication {
  question: string;
  options: string[];
  topics: AfroditaTopic[];
  scheduledKey?: string;
  adult?: true;
  subjectUserIds?: number[];
  mentionedUserIds?: number[];
  templateId?: string;
  pollTheme?: "intimacy" | "market";
}

export interface EligiblePromotionProfile {
  userId: number;
  displayName: string;
  mention?: boolean;
  body?: boolean;
}

export interface ProfilePromotionMessage {
  text: string;
  entities: Array<{
    type: "text_mention";
    offset: number;
    length: number;
    user: { id: number; is_bot: false; first_name: string };
  }>;
}

const PROFILE_PRESENTATION_TEMPLATE_COUNT = 12;

export function createProfilePromotionMessage(
  profile: EligiblePromotionProfile,
  templateIndex: number,
): ProfilePromotionMessage | undefined {
  if (!Number.isSafeInteger(profile.userId) || profile.userId <= 0) {
    return undefined;
  }
  const safeName = Array.from(
    profile.displayName
      .replace(/[\u0000-\u001f\u007f]/gu, " ")
      .replace(/\s+/gu, " ")
      .trim(),
  ).slice(0, 80).join("");
  if (!safeName) return undefined;

  const templates = [
    `🔥 ¡Se suma un perfil verificado al radar del grupo: ${safeName}! 👀 Descubre lo que decidió compartir; con respeto, siempre 💋`,
    `😏 Hoy toca novedad: ${safeName} tiene un perfil autorizado para este grupo. Curiosea sin presión y con buena onda 💜`,
    `👀 Pausa el scroll: ${safeName} cuenta con un perfil verificado aquí. La curiosidad sí; invadir la privacidad, no 🔒`,
    `💋 Nuevo perfil para descubrir: ${safeName}, con autorización vigente para el grupo. Pasa a conocer su espacio ✨`,
    `🔥 ¿Quién anda con curiosidad? ${safeName} tiene un perfil verificado autorizado. Un saludo amable siempre suma 😏`,
    `✨ El radar suma una nueva presentación: ${safeName} decidió compartir su perfil verificado. Descúbrelo a tu ritmo 💜`,
    `😈 No prometemos chisme, pero sí novedad: ${safeName} cuenta con perfil autorizado aquí. Pasen con respeto 💋`,
    `💜 Una nueva presentación para animar el ambiente: ${safeName}, con perfil verificado y autorización vigente 👀`,
    `🌶️ Subimos un poquito el misterio: ${safeName} tiene un perfil verificado para este grupo. Cero presión, pura buena vibra 😏`,
    `💌 ¿Te gusta descubrir perfiles a tu ritmo? ${safeName} cuenta con verificación y permiso para este espacio. Respeto primero 👀`,
    `🎉 Hay novedad en el grupo: ${safeName} tiene un perfil verificado autorizado. Pasen a conocer lo que eligió compartir 💋`,
    `👋 Denle una bienvenida con buena onda a ${safeName}, perfil verificado autorizado para este grupo. La curiosidad va con respeto 💜`,
  ];
  const text = templates[((templateIndex % templates.length) + templates.length) % templates.length]!;
  if (!profile.mention) return { text, entities: [] };
  const offset = text.indexOf(safeName);
  if (offset < 0) return undefined;

  return {
    text,
    entities: [{
      type: "text_mention",
      offset,
      length: safeName.length,
      user: {
        id: profile.userId,
        is_bot: false,
        first_name: safeName,
      },
    }],
  };
}

export async function getEligiblePromotionProfiles(
  store: AfroditaStore,
  api: Pick<Api, "getChatMember">,
  chatId: number,
  config: Pick<AfroditaConfig, "supabaseUrl" | "supabaseKey">,
  fetcher: typeof fetch = fetch,
  permission: ContentPermission = "catalog",
): Promise<EligiblePromotionProfile[]> {
  const state = await store.loadGroup(chatId);
  if (!config.supabaseUrl || !config.supabaseKey) {
    throw new Error("AFRODITA_SUPABASE_NOT_CONFIGURED");
  }
  const authorizedIds = new Set(
    Object.keys(state.authorizedProfiles).filter((id) =>
      Number.isSafeInteger(Number(id)),
    ),
  );
  if (authorizedIds.size === 0) return [];
  const models = await getActiveVerifiedModels(chatId, config, fetcher, Date.now(), {
    forceRefresh: true,
  });
  const eligible: EligiblePromotionProfile[] = [];
  for (const model of models) {
    if (!authorizedIds.has(String(model.userId))) continue;
    const consent = state.contentConsents[String(model.userId)];
    if (!consent?.[permission].granted) continue;
    const membership = await api.getChatMember(chatId, model.userId);
    if (
      membership.status === "left" ||
      membership.status === "kicked" ||
      (membership.status === "restricted" && !membership.is_member)
    ) continue;
    eligible.push({
      userId: model.userId,
      displayName: state.authorizedProfiles[String(model.userId)]!.displayName,
      mention: consent.mention.granted,
      body: consent.body.granted,
    });
  }
  return orderEligiblePromotionProfiles(eligible, state.recentPromotedUserIds);
}

export function orderEligiblePromotionProfiles(
  profiles: readonly EligiblePromotionProfile[],
  recentUserIds: readonly number[],
): EligiblePromotionProfile[] {
  return [...profiles].sort((left, right) => {
    const leftIndex = recentUserIds.indexOf(left.userId);
    const rightIndex = recentUserIds.indexOf(right.userId);
    return (leftIndex < 0 ? -1 : leftIndex) -
      (rightIndex < 0 ? -1 : rightIndex);
  });
}


/**
 * La selección requiere catálogo de ZEUS disponible, perfil autorizado en el
 * grupo, consentimiento vigente y membresía activa en Telegram.
 */
export async function resolvePromotionProfiles(
  store: AfroditaStore,
  api: Pick<Api, "getChatMember">,
  chatId: number,
  config: Pick<AfroditaConfig, "supabaseUrl" | "supabaseKey">,
  fetcher: typeof fetch = fetch,
  permission: ContentPermission = "catalog",
): Promise<EligiblePromotionProfile[]> {
  return getEligiblePromotionProfiles(store, api, chatId, config, fetcher, permission);
}
export async function publishPoll(
  api: Pick<Api, "sendPoll">,
  store: AfroditaStore,
  chatId: number,
  category: "commercial_poll" | "seasonal_campaign",
  content: PollPublication,
  trigger: PublicationTrigger,
  canPublish: () => boolean = () => true,
): Promise<boolean> {
  if (!canPublish()) return false;
  if (
    content.question.length === 0 ||
    content.question.length > 300 ||
    content.options.length < 2 ||
    content.options.length > 12 ||
    content.options.some((option) => option.length === 0 || option.length > 100) ||
    new Set(content.options).size !== content.options.length
  ) {
    console.warn(`[AFRODITA] Se omite encuesta inválida para Telegram groupId=${chatId}.`);
    return false;
  }
  const state = await store.loadGroup(chatId);
  if (content.adult && !state.adultConfirmedAt) return false;
  if (
    content.subjectUserIds?.some((userId) =>
      !state.contentConsents[String(userId)]?.polls.granted,
    ) ||
    content.mentionedUserIds?.some((userId) =>
      !state.contentConsents[String(userId)]?.mention.granted,
    )
  ) return false;
  const reservation = await reservePublication(
    store,
    chatId,
    category,
    {
      ...trigger,
      ...(content.templateId ? { templateId: content.templateId } : {}),
      ...(content.pollTheme ? { pollTheme: content.pollTheme } : {}),
    },
    canPublish,
  );
  if (!reservation) return false;
  const latestState = await store.loadGroup(chatId);
  if (
    !canPublish() ||
    content.adult && !latestState.adultConfirmedAt
  ) {
    await finalizePublication(store, reservation, "failed");
    return false;
  }
  if (
    content.subjectUserIds?.some((userId) =>
      !latestState.contentConsents[String(userId)]?.polls.granted,
    ) ||
    content.mentionedUserIds?.some((userId) =>
      !latestState.contentConsents[String(userId)]?.mention.granted,
    )
  ) {
    await finalizePublication(store, reservation, "failed");
    return false;
  }
  let outcome: PublicationOutcome;
  let sentPollId: string | undefined;
  try {
    const sent = await api.sendPoll(chatId, content.question, content.options, {
      is_anonymous: true,
      open_period: 600,
    });
    sentPollId = sent.poll.id;
    outcome = "published";
  } catch (error) {
    outcome = classifyPublicationFailure(error);
    await finalizePublication(store, reservation, outcome);
    console.error(
      `[AFRODITA] Poll send ${outcome} groupId=${chatId} (${safeErrorType(error)}).`,
    );
    return false;
  }
  await finalizePublication(store, reservation, outcome);
  try {
    await store.registerPoll(chatId, sentPollId!, content.topics);
    await store.updateGroup(chatId, (state) => {
      state.pollCount += 1;
      state.lastPollTopic = content.topics[0] ?? "general";
      const interval = Math.max(
        scheduledPollIntervalMs(),
        state.publications.commercial_poll.minIntervalMs,
      );
      state.publications.commercial_poll.nextScheduledAt =
        nextScheduledPollWindowTime(
          Date.now() + interval,
          state.timeZone,
          state.publications.commercial_poll.scheduleTimes,
        ) ?? Date.now() + MAX_SCHEDULED_POLL_INTERVAL_MS;
    });
  } catch (error) {
    console.error(
      `[AFRODITA] Poll was sent but local tally registration failed groupId=${chatId} (${safeErrorType(error)}).`,
    );
  }
  return true;
}

export async function publishProfilePromotion(
  api: Pick<Api, "sendMessage">,
  store: AfroditaStore,
  chatId: number,
  profile: EligiblePromotionProfile,
  trigger: PublicationTrigger,
  templateIndex: number,
  canPublish: () => boolean = () => true,
): Promise<boolean> {
  if (!canPublish()) return false;
  const state = await store.loadGroup(chatId);
  const authorizedProfile = state.authorizedProfiles[String(profile.userId)];
  if (!authorizedProfile) {
    console.info(
      `[AFRODITA] Se omite promoción groupId=${chatId}: el perfil ya no está en la lista de verificadas.`,
    );
    return false;
  }
  const consent = state.contentConsents[String(profile.userId)];
  if (!consent?.catalog.granted) return false;
  const previousPresentation = [...state.publications.verified_promotion.history]
    .reverse()
    .find((entry) =>
      entry.status === "published" &&
      /^profile-presentation-\d+$/u.test(entry.templateId ?? ""),
    );
  const previousIndex = previousPresentation?.templateId
    ? Number(previousPresentation.templateId.slice("profile-presentation-".length))
    : undefined;
  const presentationIndex = previousIndex !== undefined &&
      Number.isSafeInteger(previousIndex)
    ? (previousIndex + 1) % PROFILE_PRESENTATION_TEMPLATE_COUNT
    : templateIndex;
  const presentationId = `profile-presentation-${presentationIndex}`;
  const currentProfile = {
    ...profile,
    mention: consent.mention.granted,
  };
  const initialMessage = createProfilePromotionMessage(
    {
      userId: authorizedProfile.userId,
      displayName: authorizedProfile.displayName,
      mention: currentProfile.mention,
    },
    presentationIndex,
  );
  if (!initialMessage) {
    console.warn(
      `[AFRODITA] Se omite promoción groupId=${chatId}: identidad de Telegram inválida.`,
    );
    return false;
  }
  const reservation = await reservePublication(
    store,
    chatId,
    "verified_promotion",
    { ...trigger, templateId: presentationId },
    canPublish,
  );
  if (!reservation) return false;
  try {
    const latestState = await store.loadGroup(chatId);
    if (!canPublish()) {
      await finalizePublication(store, reservation, "failed");
      return false;
    }
    const latestConsent = latestState.contentConsents[String(profile.userId)];
    const latestProfile = latestState.authorizedProfiles[String(profile.userId)];
    if (!latestConsent?.catalog.granted || !latestProfile) {
      await finalizePublication(store, reservation, "failed");
      return false;
    }
    const latestMessage = createProfilePromotionMessage(
      {
        userId: latestProfile.userId,
        displayName: latestProfile.displayName,
        mention: latestConsent.mention.granted,
      },
      presentationIndex,
    );
    if (!latestMessage) {
      await finalizePublication(store, reservation, "failed");
      return false;
    }
    await api.sendMessage(
      chatId,
      latestMessage.text,
      latestMessage.entities.length === 0
        ? {}
        : { entities: latestMessage.entities },
    );
  } catch (error) {
    const outcome = classifyPublicationFailure(error);
    await finalizePublication(store, reservation, outcome);
    console.error(
      `[AFRODITA] Profile promotion ${outcome} groupId=${chatId} (${safeErrorType(error)}).`,
    );
    return false;
  }

  try {
    await finalizePublication(store, reservation, "published");
  } catch (error) {
    console.error(
      `[AFRODITA] Profile promotion was sent but publication status could not be persisted groupId=${chatId} (${safeErrorType(error)}).`,
    );
    return true;
  }
  try {
    await recordPromotedProfile(store, chatId, authorizedProfile.userId);
  } catch (error) {
    console.error(
      `[AFRODITA] Profile promotion was sent and marked published, but rotation could not be persisted groupId=${chatId} (${safeErrorType(error)}).`,
    );
  }
  return true;
}

export async function publishCommunityReply(
  send: () => Promise<unknown>,
  store: AfroditaStore,
  chatId: number,
  userId?: number,
  beforeSend?: () => Promise<boolean>,
  canPublish: () => boolean = () => true,
): Promise<boolean> {
  if (!canPublish()) return false;
  const trigger: PublicationTrigger = { kind: "activity", ...(userId ? { userId } : {}) };
  const reservation = await reservePublication(
    store,
    chatId,
    "community_reply",
    trigger,
    canPublish,
  );
  if (!reservation) return false;
  try {
    if (!canPublish()) {
      await finalizePublication(store, reservation, "failed");
      return false;
    }
    if (beforeSend && !await beforeSend()) {
      await finalizePublication(store, reservation, "failed");
      return false;
    }
    if (!canPublish()) {
      await finalizePublication(store, reservation, "failed");
      return false;
    }
    await send();
    await finalizePublication(store, reservation, "published");
    return true;
  } catch (error) {
    await finalizePublication(
      store,
      reservation,
      classifyPublicationFailure(error),
    );
    throw error;
  }
}

export async function publishScheduledJob(
  api: Pick<Api, "sendPoll" | "sendMessage" | "getChatMember">,
  store: AfroditaStore,
  chatId: number,
  category: PublicationCategory,
  slotKey: string,
  config: Pick<AfroditaConfig, "supabaseUrl" | "supabaseKey">,
  fetcher: typeof fetch = fetch,
  canPublish: () => boolean = () => true,
): Promise<boolean> {
  if (!canPublish()) return false;
  const trigger: PublicationTrigger = { kind: "scheduled", slotKey };
  if (category === "commercial_poll" || category === "seasonal_campaign") {
    const state = await store.loadGroup(chatId);
    const seasonal = category === "seasonal_campaign";
    if (seasonal && !state.publications.seasonal_campaign.enabled) return false;
    const now = Date.now();
    const localDate = localDateTime(now, state.timeZone).date;
    const seasonalContent = seasonal
      ? seasonalPollForDate(localDate)
      : undefined;
    if (seasonal && !seasonalContent) return false;
    let regularContent: PollPublication & { id?: string } | undefined = seasonalContent;
    if (!regularContent) {
      const recentPolls = state.publications.commercial_poll.history
        .filter((entry) => entry.status === "published" && entry.templateId)
        .slice(-10);
      regularContent = scheduledPollContent(
        "general",
        state.adultConfirmedAt !== undefined,
        Math.random(),
        slotKey,
        recentPolls.slice(-10).flatMap((entry) =>
          entry.templateId ? [entry.templateId] : [],
        ),
        recentPolls.flatMap((entry) =>
          entry.pollTheme ? [entry.pollTheme] : [],
        ),
      );
    }
    return await publishPoll(api, store, chatId, category, {
      ...regularContent,
      scheduledKey: slotKey,
    }, trigger, canPublish);
  }
  if (category === "community_reply") {
    const reservation = await reservePublication(
      store,
      chatId,
      category,
      trigger,
      canPublish,
    );
    if (!reservation) return false;
    try {
      if (!canPublish()) {
        await finalizePublication(store, reservation, "failed");
        return false;
      }
      const state = await store.loadGroup(chatId);
      if (!canPublish()) {
        await finalizePublication(store, reservation, "failed");
        return false;
      }
      await api.sendMessage(
        chatId,
        entertainmentLineReply(
          Math.random(),
          slotKey,
          state.adultConfirmedAt !== undefined,
        ),
      );
      await finalizePublication(store, reservation, "published");
      return true;
    } catch (error) {
      await finalizePublication(
        store,
        reservation,
        classifyPublicationFailure(error),
      );
      throw error;
    }
    return false;
  }
  if (category === "verified_promotion") {
    const state = await store.loadGroup(chatId);
    const profiles = await resolvePromotionProfiles(
      store,
      api,
      chatId,
      config,
      fetcher,
    );
    const profile = profiles[0];
    if (!profile) {
      console.info(`[AFRODITA] Se omite promoción groupId=${chatId}: no hay perfiles elegibles.`);
      await store.updatePublicationSettings(chatId, category, (settings) => {
        settings.history = settings.history.slice(-60);
      });
      return false;
    }
    const promotionTrigger: PublicationTrigger = {
      kind: "scheduled",
      slotKey,
      userId: profile.userId,
    };
    const published = await publishProfilePromotion(
      api,
      store,
      chatId,
      profile,
      promotionTrigger,
      state.publications.verified_promotion.history.length,
      canPublish,
    );
    if (!published) {
      console.info(`[AFRODITA] Publicación promocional omitida groupId=${chatId}.`);
    }
    return published;
  }
  return false;
}

export function isDefinitiveTelegramFailure(error: unknown): boolean {
  return classifyPublicationFailure(error) === "failed";
}

function safeErrorType(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  return /^[A-Za-z][A-Za-z0-9]{0,47}$/.test(name) ? name : "unknown";
}
