import { AFRODITA_TOPICS } from "./types.js";
import type { AfroditaState, AfroditaTopic } from "./types.js";

const TOPIC_TERMS: Record<Exclude<AfroditaTopic, "general">, string[]> = {
  productos: ["producto", "vendo", "venta", "catalogo", "precio", "oferta"],
  servicios: ["servicio", "consulta", "reserva", "agenda", "asesoria", "pedido"],
  belleza: ["belleza", "maquillaje", "piel", "cabello", "estetica", "cosmetica"],
  moda: ["moda", "ropa", "vestido", "accesorio", "estilo", "zapatos"],
  comida: ["comida", "receta", "cocinar", "restaurante", "pizza", "cafe"],
  bienestar: ["bienestar", "masaje", "yoga", "relajacion", "saludable", "cuidado"],
};

export interface MessageObservation {
  text: string;
  hourUtc: number;
  repliedToBot: boolean;
  explicitQuietRequest: boolean;
}

export function classifyTopic(text: string): AfroditaTopic {
  const normalized = text
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  for (const topic of AFRODITA_TOPICS) {
    if (topic === "general") continue;
    if (TOPIC_TERMS[topic].some((term) => normalized.includes(term))) return topic;
  }
  return "general";
}

export function observeMessage(
  state: AfroditaState,
  observation: MessageObservation,
  now: number,
): void {
  const topic = classifyTopic(observation.text);
  state.messageCount += 1;
  state.messagesSincePoll += 1;
  state.topicCounts[topic] += 1;
  const hour = Math.min(23, Math.max(0, Math.floor(observation.hourUtc)));
  state.activityByHour[hour] += 1;
  if (observation.repliedToBot) {
    state.usefulReplies += 1;
    state.replyTopicCounts[topic] += 1;
  }
  if (observation.explicitQuietRequest) {
    state.explicitQuietRequests += 1;
    state.quietUntil = Math.max(state.quietUntil, now + 12 * 60 * 60 * 1000);
  }
}

export function preferredTopic(state: AfroditaState): AfroditaTopic {
  const topics = AFRODITA_TOPICS.filter((topic) => topic !== "general");
  return topics.reduce((current, candidate) => {
    const score = (topic: AfroditaTopic): number =>
      state.pollVotes[topic] * 3 +
      state.replyTopicCounts[topic] * 2 +
      state.topicCounts[topic];
    const currentScore = score(current);
    const candidateScore = score(candidate);
    if (candidateScore > currentScore) return candidate;
    if (
      candidateScore === currentScore &&
      state.topicCounts[candidate] > state.topicCounts[current]
    ) {
      return candidate;
    }
    return current;
  }, "general" as AfroditaTopic);
}
