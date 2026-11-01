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
import type { AfroditaTopic, PublicationCategory } from "./types.js";
import { getActiveVerifiedModels } from "./verified-users.js";

export interface PollPublication {
  question: string;
  options: string[];
  topics: AfroditaTopic[];
  scheduledKey?: string;
}

export interface EligiblePromotionProfile {
  userId: number;
  displayName: string;
}

export interface ProfilePromotionMessage {
  text: string;
  entities: [{
    type: "text_mention";
    offset: number;
    length: number;
    user: { id: number; is_bot: false; first_name: string };
  }];
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
    `✨ Conoce el perfil verificado de ${safeName}, autorizado para presentarse en este grupo. Descubre la información que decidió compartir.`,
    `👀 Una recomendación de la comunidad: el perfil verificado de ${safeName} está autorizado para presentarse aquí. Consulta su información pública.`,
    `💫 Hoy destacamos a ${safeName}: su perfil verificado cuenta con autorización para aparecer en este grupo. Conoce solo los detalles que decidió publicar.`,
  ];
  const text = templates[((templateIndex % templates.length) + templates.length) % templates.length]!;
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
    const membership = await api.getChatMember(chatId, model.userId);
    if (
      membership.status === "left" ||
      membership.status === "kicked" ||
      (membership.status === "restricted" && !membership.is_member)
    ) continue;
    eligible.push({
      userId: model.userId,
      displayName: state.authorizedProfiles[String(model.userId)]!.displayName,
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
 * Selección de promociones SIN depender de Supabase: usa la autorización ya
 * concedida en local (`authorizedProfiles` ∩ `promotionConsents`) y revalida
 * la membresía activa con Telegram. Respeta revocaciones y rotación.
 */
export async function getAuthorizedPromotionProfiles(
  store: AfroditaStore,
  api: Pick<Api, "getChatMember">,
  chatId: number,
): Promise<EligiblePromotionProfile[]> {
  const state = await store.loadGroup(chatId);
  const profiles: EligiblePromotionProfile[] = [];
  for (const [key, profile] of Object.entries(state.authorizedProfiles)) {
    if (!Number.isSafeInteger(Number(key))) {
      continue;
    }
    let membership: Awaited<ReturnType<Api["getChatMember"]>>;
    try {
      membership = await api.getChatMember(chatId, profile.userId);
    } catch {
      continue;
    }
    if (
      membership.status === "left" ||
      membership.status === "kicked" ||
      (membership.status === "restricted" && !membership.is_member)
    ) continue;
    profiles.push({ userId: profile.userId, displayName: profile.displayName });
  }
  return orderEligiblePromotionProfiles(profiles, state.recentPromotedUserIds);
}

/**
 * Resolución de perfiles promocionables: valida contra el catálogo de ZEUS
 * cuando Supabase está disponible (comportamiento original fail-closed) y,
 * si el catálogo no está configurado o falla, recurre a la autorización local
 * ya concedida para que la publicación automática no quede bloqueada.
 */
export async function resolvePromotionProfiles(
  store: AfroditaStore,
  api: Pick<Api, "getChatMember">,
  chatId: number,
  config: Pick<AfroditaConfig, "supabaseUrl" | "supabaseKey">,
  fetcher: typeof fetch = fetch,
): Promise<EligiblePromotionProfile[]> {
  try {
    return await getEligiblePromotionProfiles(store, api, chatId, config, fetcher);
  } catch (error) {
    console.info(
      `[AFRODITA] Catálogo no disponible para promociones groupId=${chatId} ` +
        `(${error instanceof Error ? error.name : "unknown"}); ` +
        "se usa la autorización local ya concedida.",
    );
    return await getAuthorizedPromotionProfiles(store, api, chatId);
  }
}
export async function publishPoll(
  api: Pick<Api, "sendPoll">,
  store: AfroditaStore,
  chatId: number,
  category: "commercial_poll" | "seasonal_campaign",
  content: PollPublication,
  trigger: PublicationTrigger,
): Promise<boolean> {
  const reservation = await reservePublication(
    store,
    chatId,
    category,
    trigger,
  );
  if (!reservation) return false;
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
  const message = createProfilePromotionMessage(
    {
      userId: authorizedProfile.userId,
      displayName: authorizedProfile.displayName,
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
    const boldText =
      templateIndex % 2 === 1
        ? boldProfilePromotion(
            authorizedProfile,
            Math.random(),
            `${profile.userId}:${templateIndex}`,
          )
        : "";
    await api.sendMessage(chatId, boldText || message.text, boldText ? {} : {
      entities: message.entities,
    });
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
      regularContent = entertainmentPollContent("general", Math.random(), slotKey);
      // Personalización: si hay perfiles YA autorizados, alterna encuesta
      // sobre perfiles con la encuesta general (sin nuevas autorizaciones).
      try {
        const eligible = await resolvePromotionProfiles(store, api, chatId, config, fetcher);
        if (eligible.length > 0) {
          const varied = saltedRandomValue(Math.random(), slotKey);
          if (varied < 0.5) {
            regularContent = verifiedModelsPollContent(
              "general",
              eligible.map((candidate) => ({
                groupId: chatId,
                userId: candidate.userId,
                displayName: candidate.displayName,
                media: [],
              })),
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
      await api.sendMessage(chatId, entertainmentLineReply(Math.random(), slotKey));
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
