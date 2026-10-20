import type { AfroditaTopic } from "./types.js";
import type { VerifiedModel } from "./verified-users.js";
import { sanitizeIncomingText } from "./utils/sanitizer.js";

const RESPONSES: Record<AfroditaTopic, string[]> = {
  productos: [
    "¿Qué producto local recomiendan de verdad? Así da gusto descubrir cosas nuevas ✨",
    "Pregunta curiosa: ¿qué producto les resolvió un pequeño problema últimamente? 👀",
    "¿Qué les gusta saber antes de animarse a probar algo nuevo? 💬",
  ],
  servicios: [
    "¿Qué servicio local les ha hecho la vida más fácil? 🧡",
    "A ver, ¿qué valoran más al reservar un servicio: confianza, rapidez o trato? 💬",
    "¿Qué recomendación de servicio sí compartirían con una amiga? ✨",
  ],
  belleza: [
    "¿Qué pequeño ritual de cuidado disfrutan y sí logran mantener? 🌸",
    "¿Qué consejo de belleza les dieron y resultó ser buenísimo? ✨",
    "¿Qué prefieren descubrir: cuidado de piel, cabello o maquillaje? 💄",
  ],
  moda: [
    "¿Qué prenda o accesorio les levanta cualquier conjunto? 👗",
    "¿Son de básicos favoritos o de probar un estilo nuevo? 😄",
    "¿Qué detalle buscan al elegir ropa: comodidad, color o versatilidad? ✨",
  ],
  comida: [
    "¿Qué emprendimiento de comida local merece más recomendaciones? 😋",
    "¿Qué sabor les convence para probar un negocio nuevo? 🍰",
    "¿Cuál es esa compra rica que siempre comparten con alguien? ☕",
  ],
  bienestar: [
    "¿Qué actividad les ayuda a recargar energías sin complicarse? 🌿",
    "¿Qué servicio de bienestar les gustaría encontrar cerca? ✨",
    "¿Qué significa para ustedes darse un ratito de cuidado? 🧡",
  ],
  general: [
    "A ver, ¿qué emprendimiento o talento local les gustaría descubrir por aquí? ✨",
    "Pregunta de comunidad: ¿qué hace que recomienden un negocio con confianza? 💬",
    "¿Qué producto o servicio les gustaría encontrar más fácilmente? 👀",
    "Paso a saludar: ¿qué buena recomendación local tienen para compartir? 🧡",
  ],
};

export function catalogReply(topic: AfroditaTopic, randomValue = Math.random()): string {
  const options = RESPONSES[topic];
  const index = Math.min(options.length - 1, Math.floor(randomValue * options.length));
  return options[Math.max(0, index)];
}

export function pollContent(
  topic: AfroditaTopic,
  randomValue = Math.random(),
): {
  question: string;
  options: string[];
  topics: AfroditaTopic[];
} {
  const topics: AfroditaTopic[] = [
    "productos",
    "servicios",
    "belleza",
    "moda",
    "comida",
    "bienestar",
  ];
  const labels: Record<(typeof topics)[number], string> = {
    productos: "Productos",
    servicios: "Servicios",
    belleza: "Belleza y cuidado",
    moda: "Moda",
    comida: "Comida",
    bienestar: "Bienestar",
    general: "Recomendación general",
  };
  const ordered = [
    ...(topic === "general" ? [] : [topic]),
    ...topics.filter((candidate) => candidate !== topic),
  ].slice(0, 4);
  const questions = [
    "¿Qué tipo de recomendación o negocio local les interesa descubrir?",
    "Si pudieran conocer un emprendimiento local hoy, ¿de qué sería?",
    "¿Qué recomendación útil les gustaría encontrar en esta comunidad?",
  ];
  const questionIndex = Math.min(
    questions.length - 1,
    Math.max(0, Math.floor(randomValue * questions.length)),
  );
  return {
    question: questions[questionIndex]!,
    options: ordered.map((candidate) => labels[candidate as keyof typeof labels]),
    topics: ordered,
  };
}

export function verifiedModelsPollContent(
  topic: AfroditaTopic,
  models: readonly VerifiedModel[],
  randomValue = Math.random(),
): { question: string; options: string[]; topics: AfroditaTopic[] } {
  if (models.length === 0) return pollContent(topic, randomValue);
  const uniqueModels = models.filter(
    (model, index, all) =>
      all.findIndex((candidate) => candidate.userId === model.userId) === index,
  );
  const options = uniqueModels.slice(0, 9).map((model) =>
    `Descubrir el perfil de ${plainProfileName(model.displayName)}`.slice(0, 100),
  );
  options.push("Otra recomendación");
  const questionIndex = Math.min(
    2,
    Math.max(0, Math.floor(randomValue * 3)),
  );
  const questions = [
    "¿Qué perfil de una creadora verificada te da curiosidad descubrir? 😉",
    "A ver, ¿de quién te gustaría conocer el catálogo o las novedades? ✨",
    "¿Qué creadora verificada te llamó la atención y qué te gustaría descubrir? 💫",
  ];
  return {
    question: questions[questionIndex]!,
    options,
    topics: options.map((_, index) =>
      index < options.length - 1 ? "servicios" : "general",
    ),
  };
}

export function isCommercialInquiry(text: string): boolean {
  const normalized = normalizeForMatching(text);
  const asksWhetherAlone =
    /\b(?:esta|anda|se encuentra)\s+sola\b/u.test(normalized) ||
    /\bsola\s+(?:ahora|hoy|disponible)\b/u.test(normalized);
  const hasOfferKeyword =
    /\b(?:catalogo|catalogos|fotos?|imagenes?|llamadas?|videollamadas?|servicios?|modelos?|contenido|precios?|reservas?|packs?|sola|culo|tetas?|senos?|vagina|escort|sexting|novia virtual)\b/u.test(normalized);
  const hasInquiryIntent =
    /\b(?:quiero|busco|tienen|hay|disponible|ver|muestr|compart|mand|recomi|alguien|donde|quien|puedo|me|need|want|looking|available|esta|estan|anda|habla|cuesta|costar|vale|cuanto)\w*\b/u.test(normalized);
  if (/\bsola\b/u.test(normalized)) return asksWhetherAlone;
  return hasOfferKeyword && (hasInquiryIntent || normalized.trim().split(/\s+/u).length <= 3);
}

export function isExplicitMediaRequest(text: string): boolean {
  return /(?:\b(?:foto|fotos|imagen|imagenes|media|video|videos|catalogo|catalogos)\b)/iu.test(
    normalizeForMatching(text),
  );
}

export function verifiedModelsReply(
  models: readonly VerifiedModel[],
  inquiry = "",
  randomValue = Math.random(),
): string {
  const names = models
    .slice(0, 3)
    .map((model) => plainProfileName(model.displayName))
    .filter(Boolean);
  if (names.length === 0) {
    return "Ahora mismo no encuentro perfiles verificados activos para recomendar. Si buscas un catálogo, fotos o información de una llamada, vuelve a preguntar más tarde. 💫";
  }
  const list = names.join(", ");
  const remaining = models.length > names.length
    ? ` y ${models.length - names.length} más`
    : "";
  const normalized = normalizeForMatching(inquiry);
  if (/\bsola\b/u.test(normalized)) {
    return `Puedo confirmar qué perfiles están verificados, no la disponibilidad personal de nadie 💫. ${list}${remaining} tienen perfil activo; revisa únicamente los canales o la información que cada creadora haya publicado para consultas.`;
  }

  const intent = /\b(?:videollamadas?|llamadas?|sexting)\b/u.test(normalized)
    ? "llamada"
    : /\b(?:catalogos?|precios?|packs?|escort|novia virtual)\b/u.test(normalized)
      ? "catalogo"
      : /\b(?:fotos?|imagenes?)\b/u.test(normalized)
        ? "fotos"
        : "general";
  const responses: Record<typeof intent, string[]> = {
    llamada: [
      `¿Buscas una videollamada? 😉 ${list}${remaining} tienen perfil verificado activo. Consulta la información que cada creadora haya publicado y confirma directamente sus condiciones y disponibilidad.`,
      `Una llamada puede ser una forma divertida de conocer a alguien ✨. Revisa el perfil público de ${list}${remaining} y contacta solo por el canal que la creadora haya compartido.`,
    ],
    catalogo: [
      `¿Con ganas de echar un vistazo? 😉 ${list}${remaining} tienen perfil verificado activo. Revisa sus catálogos publicados para conocer opciones y precios, sin compromiso.`,
      `Los detalles buenos están en la información que cada creadora comparte ✨. Puedes revisar el perfil público de ${list}${remaining} y consultar allí sus opciones.`,
    ],
    fotos: [
      `¿Buscas fotos o novedades? 👀 ${list}${remaining} tienen perfil verificado activo. Revisa el material que cada creadora haya publicado y consulta sus opciones por el canal que ella indique.`,
      `Te ayudo a encontrar perfiles, no a compartir material privado 💫. Puedes revisar lo que ${list}${remaining} hayan publicado en sus perfiles y preguntar respetando sus preferencias.`,
    ],
    general: [
      `¡Claro! 💫 Entre las creadoras verificadas activas están ${list}${remaining}. Echa un vistazo a la información que cada una comparte y consulta sus opciones sin presión.`,
      `¿Te dio curiosidad? 😉 ${list}${remaining} tienen perfil verificado activo. Revisa sus novedades públicas y, si te interesa, usa únicamente el contacto que hayan compartido.`,
      `Hay perfiles para descubrir ✨: ${list}${remaining}. Mira sus catálogos o novedades publicados y confirma directamente cada detalle con la creadora.`,
    ],
  };
  const options = responses[intent];
  const index = Math.min(
    options.length - 1,
    Math.max(0, Math.floor(randomValue * options.length)),
  );
  return options[index]!;
}

export function findRequestedVerifiedModel(
  text: string,
  models: readonly VerifiedModel[],
): VerifiedModel | undefined {
  const normalizedText = normalizeForMatching(text);
  return models.find((model) => {
    const name = normalizeForMatching(model.displayName);
    const username = model.username
      ? normalizeForMatching(model.username.replace(/^@/u, ""))
      : "";
    return (
      (name.length >= 2 && normalizedText.includes(name)) ||
      (username.length >= 4 && normalizedText.includes(username))
    );
  });
}

function normalizeForMatching(value: string): string {
  return sanitizeIncomingText(value)
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "");
}

function plainProfileName(value: string): string {
  return value.replace(/[\r\n\0]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 60);
}

export function isSafeGeneratedReply(value: string): boolean {
  const reply = value.trim();
  if (
    reply.length === 0 ||
    reply.length > 350 ||
    /(?:https?:\/\/|www\.|t\.me\/|@[A-Za-z0-9_]{4,}|\/[a-z]{2,})/iu.test(reply)
  ) {
    return false;
  }
  return !/(?:sé que estás deprimid|tienes depresión|por tu religión|por tu orientación|por tu edad|menor de edad.{0,30}(?:sexo|desnud)|abuso sexual infantil)/iu.test(reply);
}
