import type { Api } from "grammy";
import type { AfroditaConfig } from "./config.js";
import {
  boldProfilePromotion,
  entertainmentLineReply,
  entertainmentPollContent,
  saltedRandomValue,
  verifiedModelsPollContent,
} from "./messages.js";
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
    `🌸 Hoy damos la bienvenida al perfil verificado de ${safeName}, autorizado para este grupo. Puedes conocer solo la información que decidió compartir.`,
    `✨ Una nueva presentación para la comunidad: ${safeName} tiene un perfil verificado y autorizado aquí. La decisión de qué publicar es siempre suya.`,
    `👋 Si aún no lo conocías, ${safeName} cuenta con un perfil verificado autorizado en este grupo. Acércate con respeto y consulta únicamente lo que publicó.`,
    `💫 Espacio para descubrir perfiles con calma: ${safeName} cuenta con un perfil verificado autorizado para este grupo. Cada detalle compartido depende de esa persona.`,
    `🌿 Presentación de hoy: ${safeName}, perfil verificado con autorización para este grupo. Sin suposiciones; solo vale lo que eligió hacer público.`,
    `🧡 La comunidad también se construye con presentaciones respetuosas. ${safeName} tiene un perfil verificado autorizado para este grupo.`,
    `🔎 ¿Te gusta descubrir perfiles nuevos? ${safeName} cuenta con un perfil verificado autorizado aquí; revisa únicamente la información que publicó.`,
    `🌟 Damos un espacio a ${safeName}, con perfil verificado y autorización vigente en el grupo. La conversación y el interés deben ser siempre respetuosos.`,
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
): Promise<boolean> {
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
    trigger,
  );
  if (!reservation) return false;
  const latestState = await store.loadGroup(chatId);
  if (
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
): Promise<boolean> {
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
  const currentProfile = {
    ...profile,
    mention: consent.mention.granted,
    body: consent.body.granted,
  };
  const message = createProfilePromotionMessage(
    {
      userId: authorizedProfile.userId,
      displayName: authorizedProfile.displayName,
      mention: currentProfile.mention,
      body: currentProfile.body,
    },
    templateIndex,
  );
  if (!message) {
    console.warn(
      `[AFRODITA] Se omite promoción groupId=${chatId}: identidad de Telegram inválida.`,
    );
    return false;
  }
  const reservation = await reservePublication(
    store,
    chatId,
    "verified_promotion",
    trigger,
  );
  if (!reservation) return false;
  try {
    const latestState = await store.loadGroup(chatId);
    const latestConsent = latestState.contentConsents[String(profile.userId)];
    if (!latestConsent?.catalog.granted) {
      await finalizePublication(store, reservation, "failed");
      return false;
    }
    const boldText =
      latestState.adultConfirmedAt &&
      latestConsent.body.granted &&
      templateIndex % 2 === 1
        ? boldProfilePromotion(
            {
              displayName: authorizedProfile.displayName,
              ...(latestConsent.mention.granted && authorizedProfile.username
                ? { username: authorizedProfile.username }
                : {}),
            },
            Math.random(),
            `${profile.userId}:${templateIndex}`,
          )
        : "";
    await api.sendMessage(
      chatId,
      boldText || message.text,
      boldText || !latestConsent.mention.granted || message.entities.length === 0
        ? {}
        : { entities: message.entities },
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
): Promise<boolean> {
  const trigger: PublicationTrigger = { kind: "activity", ...(userId ? { userId } : {}) };
  const reservation = await reservePublication(
    store,
    chatId,
    "community_reply",
    trigger,
  );
  if (!reservation) return false;
  try {
    if (beforeSend && !await beforeSend()) {
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
): Promise<void> {
  const trigger: PublicationTrigger = { kind: "scheduled", slotKey };
  if (category === "commercial_poll" || category === "seasonal_campaign") {
    const state = await store.loadGroup(chatId);
    const seasonal = category === "seasonal_campaign";
    if (seasonal && !state.publications.seasonal_campaign.enabled) return;
    const now = Date.now();
    const localDate = localDateTime(now, state.timeZone).date;
    const seasonalContent = seasonal
      ? seasonalPollForDate(localDate)
      : undefined;
    if (seasonal && !seasonalContent) return;
    let regularContent: PollPublication & { id?: string } | undefined = seasonalContent;
    if (!regularContent) {
      regularContent = entertainmentPollContent(
        "general",
        Math.random(),
        slotKey,
        state.adultConfirmedAt !== undefined,
      );
      // Personalización: si hay perfiles YA autorizados, alterna encuesta
      // sobre perfiles con la encuesta general (sin nuevas autorizaciones).
      try {
        const eligible = await resolvePromotionProfiles(
          store,
          api,
          chatId,
          config,
          fetcher,
          "polls",
        );
        if (eligible.length > 0) {
          const varied = saltedRandomValue(Math.random(), slotKey);
          if (varied < 0.5) {
            const latestState = await store.loadGroup(chatId);
            regularContent = verifiedModelsPollContent(
              "general",
              eligible.map((candidate) => {
                const profile = latestState.authorizedProfiles[String(candidate.userId)];
                return {
                  groupId: chatId,
                  userId: candidate.userId,
                  displayName: candidate.displayName,
                  ...(candidate.mention && profile?.username
                    ? { username: profile.username }
                    : {}),
                  media: [],
                };
              }),
              varied,
            );
          }
        }
      } catch {
        // Sin perfiles elegibles se conserva la encuesta comunitaria.
      }
    }
    await publishPoll(api, store, chatId, category, {
      ...regularContent,
      scheduledKey: slotKey,
    }, trigger);
    return;
  }
  if (category === "community_reply") {
    const reservation = await reservePublication(
      store,
      chatId,
      category,
      trigger,
    );
    if (!reservation) return;
    try {
      const state = await store.loadGroup(chatId);
      await api.sendMessage(
        chatId,
        entertainmentLineReply(
          Math.random(),
          slotKey,
          state.adultConfirmedAt !== undefined,
        ),
      );
      await finalizePublication(store, reservation, "published");
    } catch (error) {
      await finalizePublication(
        store,
        reservation,
        classifyPublicationFailure(error),
      );
      throw error;
    }
    return;
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
      return;
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
    );
    if (!published) {
      console.info(`[AFRODITA] Publicación promocional omitida groupId=${chatId}.`);
    }
  }
}

export function isDefinitiveTelegramFailure(error: unknown): boolean {
  return classifyPublicationFailure(error) === "failed";
}

function safeErrorType(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  return /^[A-Za-z][A-Za-z0-9]{0,47}$/.test(name) ? name : "unknown";
}
