import type { AfroditaTopic } from "./types.js";

export interface SeasonalPoll {
  id: string;
  question: string;
  options: string[];
  topics: AfroditaTopic[];
}

const SEASONAL_CAMPAIGNS: Record<string, Omit<SeasonalPoll, "id">> = {
  "01-01": {
    question: "¿Qué te gustaría descubrir en la comunidad este año?",
    options: ["Productos locales", "Servicios", "Ideas y novedades", "Otra cosa"],
    topics: ["productos", "servicios", "general", "general"],
  },
  "02-14": {
    question: "¿Qué plan temático te gustaría ver en la comunidad?",
    options: ["Autocuidado", "Ideas de regalo", "Comida local", "Otro tema"],
    topics: ["bienestar", "productos", "comida", "general"],
  },
  "10-31": {
    question: "¿Qué tema te gustaría para una dinámica de Halloween?",
    options: ["Misterio", "Fantasía", "Estilo glam", "Otra temática"],
    topics: ["general", "moda", "belleza", "general"],
  },
  "12-24": {
    question: "¿Qué recomendación local te interesa para estas fiestas?",
    options: ["Comida", "Regalos", "Estilo", "Bienestar"],
    topics: ["comida", "productos", "moda", "bienestar"],
  },
  "12-25": {
    question: "¿Qué te gustaría compartir con la comunidad hoy?",
    options: ["Una receta", "Un regalo local", "Un plan", "Una recomendación"],
    topics: ["comida", "productos", "bienestar", "general"],
  },
};

export function seasonalPollForDate(
  date: string,
): SeasonalPoll | undefined {
  const monthDay = date.slice(5, 10);
  const campaign = SEASONAL_CAMPAIGNS[monthDay];
  return campaign ? { id: `${date}:${monthDay}`, ...campaign } : undefined;
}
