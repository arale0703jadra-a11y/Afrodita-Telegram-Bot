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
    (model.username && /^[A-Za-z0-9_]{1,32}$/u.test(model.username)
      ? `Descubrir el perfil de @${model.username}`
      : `Descubrir el perfil de ${plainProfileName(model.displayName)}`).slice(0, 100),
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
    .map((model) =>
      model.username && /^[A-Za-z0-9_]{1,32}$/u.test(model.username)
        ? `@${model.username}`
        : plainProfileName(model.displayName),
    )
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
      `¿Quieres algo más picante? 🔥 ${list}${remaining} están activas hoy. Revisa lo que cada una publica: fotos, vídeos o videollamadas siempre según lo que ella haya autorizado.`,
      `Uy, qué ganas de contarles 😏 Entre las verificadas de hoy están ${list}${remaining}. Curvas, actitud y contenido que sí vale la pena descubrir en sus perfiles públicos.`,
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
  const matchingUserIds = matchingVerifiedUserIds(text, models);
  if (matchingUserIds.size !== 1) return undefined;
  const [userId] = matchingUserIds;
  return models.find((model) => model.userId === userId);
}

export type MediaProfileSelection =
  | { kind: "profile"; model: VerifiedModel; source: "requested" | "fallback" }
  | { kind: "unspecified" }
  | { kind: "unresolved" };

const GENERIC_MEDIA_REQUEST_WORDS = new Set([
  "a",
  "ahora",
  "alguien",
  "alguna",
  "algunas",
  "alguno",
  "algunos",
  "al",
  "algun",
  "cualquier",
  "cualquiera",
  "de",
  "dime",
  "el",
  "ella",
  "ellas",
  "ellos",
  "ensena",
  "ensename",
  "ensenas",
  "favor",
  "foto",
  "fotos",
  "hay",
  "imagen",
  "imagenes",
  "la",
  "las",
  "lo",
  "los",
  "mandame",
  "mandar",
  "manda",
  "mandas",
  "me",
  "media",
  "modelo",
  "modelos",
  "muestra",
  "muestrame",
  "mostrar",
  "opciones",
  "para",
  "perfil",
  "perfiles",
  "por",
  "porfa",
  "puede",
  "pueden",
  "puedes",
  "que",
  "quiero",
  "recomienda",
  "recomiendame",
  "te",
  "tiene",
  "tienen",
  "tienes",
  "ver",
  "verificada",
  "verificadas",
  "verificado",
  "verificados",
  "video",
  "videos",
  "y",
  "un",
  "una",
  "unas",
  "uno",
  "unos",
]);

export function selectMediaProfile(
  text: string,
  models: readonly VerifiedModel[],
): MediaProfileSelection {
  const matchingUserIds = matchingVerifiedUserIds(text, models);
  if (matchingUserIds.size > 1) return { kind: "unresolved" };
  if (matchingUserIds.size === 1) {
    const [userId] = matchingUserIds;
    const model = models.find((candidate) => candidate.userId === userId);
    return model
      ? { kind: "profile", model, source: "requested" }
      : { kind: "unresolved" };
  }

  const normalizedText = normalizeForMatching(text);
  const words = normalizedText.match(/[\p{L}\p{N}_]+/gu) ?? [];
  if (words.some((word) => !GENERIC_MEDIA_REQUEST_WORDS.has(word))) {
    return { kind: "unresolved" };
  }

  const fallback = models.find((model) => model.media.length > 0);
  return fallback
    ? { kind: "profile", model: fallback, source: "fallback" }
    : { kind: "unspecified" };
}

function matchingVerifiedUserIds(
  text: string,
  models: readonly VerifiedModel[],
): Set<number> {
  const normalizedText = normalizeForMatching(text);
  return new Set(models.flatMap((model) => {
    const name = normalizeForMatching(model.displayName);
    const username = model.username
      ? normalizeForMatching(model.username.replace(/^@/u, ""))
      : "";
    return (
      (name.length >= 2 && includesWholeProfileName(normalizedText, name)) ||
      (username.length >= 4 && includesWholeProfileName(normalizedText, username))
    ) ? [model.userId] : [];
  }));
}

function includesWholeProfileName(text: string, value: string): boolean {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    `(^|[^\\p{L}\\p{N}_])${escaped}(?=$|[^\\p{L}\\p{N}_])`,
    "u",
  ).test(text);
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

// ===== CAPA DE ENTRETENIMIENTO ADULTO (18+) =====
// Encuestas generales para TODAS las integrantes (verificadas o no).
// Solo en grupos de adultos; nunca atribuye preferencias a personas concretas.

export interface EntertainmentPoll {
  question: string;
  options: string[];
}

export const ADULT_POLL_BANK: EntertainmentPoll[] = [
  { question: "A ver, ¿qué prefieren esta noche? 😏", options: ["Videollamada", "Sexting", "Vídeo personalizado"] },
  { question: "Si les llega un mensaje picante, ¿qué prefieren? 🔥", options: ["Fotos atrevidas", "Un video juguetón", "Una llamada sorpresa"] },
  { question: "¿Qué modo de conquista digital les gusta más? 😈", options: ["Mensajes coquetos", "Videollamada a deshoras", "Contenido personalizado"] },
  { question: "¿Qué prefieren en una noche especial? 💋", options: ["Algo romántico", "Algo atrevido", "Algo espontáneo"] },
  { question: "Anoche, ¿a qué le dieron prioridad? 😏", options: ["Conversación caliente", "Videollamada", "Enviar algo picante"] },
  { question: "¿Qué les excita más: oír o ver? 🔥", options: ["Escuchar descripciones", "Ver contenido", "Los dos, obvio"] },
  { question: "¿Qué parte del cuerpo les vuelve locos? 😈", options: ["Culo", "Tetas", "Caderas", "Piernas", "Pies"] },
  { question: "¿Qué les llama más la atención de una mujer? 🔥", options: ["Unas buenas nalgas", "Unas tetas bonitas", "Unas piernas largas", "Una cintura de avispa"] },
  { question: "A ver sin filtros, ¿qué cuerpo les gusta más? 😏", options: ["Cuerpazo curvilíneo", "Deportiva y marcada", "Suave y sensual", "Redondeada y perfecta"] },
  { question: "¿Cuál es el mejor regalo visual? 💋", options: ["Un trasero espectacular", "Unos pechos naturales", "Unas curvas de película", "Todo el paquete"] },
  { question: "¿Qué detalle físico las voltea en segundos? 🔥", options: ["Caderas", "Nalgas", "Piernas", "Boca", "Mirada sensual"] },
  { question: "¿De qué hablan primero cuando comentan a una mujer? 😈", options: ["Su cuerpazo", "Su actitud atrevida", "Su sonrisa coqueta", "Su forma de moverse"] },
  { question: "Vamos con una pregunta más atrevida… ¿qué posición prefieren? 😈", options: ["Misionero", "Vaquera", "De lado", "Desde atrás"] },
  { question: "¿Cuál es su posición favorita para una noche larga? 🔥", options: ["De espaldas", "Encima", "Sentada", "De pie"] },
  { question: "Clásico o aventurero: ¿qué posición eligen? 😏", options: ["Misionero bien hecho", "Vaquera intensa", "Desde atrás", "69"] },
  { question: "¿Qué posición les hace correr más rápido? 💋", options: ["De lado", "Cowgirl", "Perrito", "Rodeando"] },
  { question: "Pregunta picante del día: ¿misionero o contra la pared? 😈", options: ["Misionero", "Contra la pared", "Las dos"] },
  { question: "¿Qué posición les gusta fingir que no conocen? 🔥", options: ["La de la cuchara", "Caballito", "De pie contra la pared", "Japonesa"] },
  { question: "¿Qué contenido les gusta más? 💋", options: ["Fotos atrevidas", "Vídeos", "Videollamadas", "Contenido personalizado"] },
  { question: "¿Qué prefieren recibir de una creadora? 😏", options: ["Un pack", "Un video personalizado", "Una videollamada", "Solo charla coqueta"] },
  { question: "¿Cuál es el mejor contenido para pasar la noche? 🔥", options: ["Fotos sensuales", "Videos íntimos", "Llamada en vivo", "Audios picantes"] },
  { question: "Si pudieran pedir algo personalizado, ¿qué sería? 😈", options: ["Un video con su nombre", "Fotos con pose especial", "Un striptease virtual", "Una fantasía narrada"] },
  { question: "¿Qué les parece más íntimo? 💋", options: ["Videollamada", "Sexting", "Contenido grabado solo para ellos"] },
  { question: "¿Son de mensajería coqueta o de llamadas a deshoras? 😏", options: ["Mensajes todo el día", "Videollamadas de madrugada", "Las dos, sin vergüenza"] },
  { question: "¿Qué les gusta más de una noche picante? 🔥", options: ["La tensión", "Las sorpresas", "Que manden contenido", "Todo"] },
  { question: "A ver, ¿a qué hora se ponen más coquetas? 😈", options: ["Madrugada", "Tarde", "Noche", "Siempre"] },
  { question: "¿Qué prefieren: que las conquisten o conquistar? 💋", options: ["Que las conquisten", "Conquistar", "Jugar a medias"] },
  { question: "¿Les gusta mandar fotos picantes o recibir? 😏", options: ["Mandar", "Recibir", "Intercambiar"] },
];

function entertainmentSaltIndex(salt: string): number {
  let hash = 5381;
  for (let index = 0; index < salt.length; index += 1) {
    hash = ((hash << 5) + hash + salt.charCodeAt(index)) >>> 0;
  }
  return hash;
}

/**
 * Encuesta de entretenimiento general (18+). No requiere verificación:
 * votan todas las integrantes. `salt` (día/slot) da variedad para no repetir.
 */
export function adultPollContent(
  randomValue = Math.random(),
  salt = "",
): { question: string; options: string[]; topics: AfroditaTopic[] } {
  const pool = ADULT_POLL_BANK;
  const offset = salt ? entertainmentSaltIndex(salt) % pool.length : 0;
  const base = Math.min(pool.length - 1, Math.max(0, Math.floor(randomValue * pool.length)));
  const poll = pool[(base + offset) % pool.length]!;
  return {
    question: poll.question,
    options: poll.options,
    topics: poll.options.map(() => "general"),
  };
}

/**
 * Mezcla encuesta comunitaria (existente) con encuesta adulta general.
 * randomValue < 0.5 conserva el comportamiento original exacto.
 */
export function entertainmentPollContent(
  topic: AfroditaTopic,
  randomValue = Math.random(),
  salt = "",
): { question: string; options: string[]; topics: AfroditaTopic[] } {
  if (randomValue < 0.5) return pollContent(topic, randomValue * 2);
  return adultPollContent((randomValue - 0.5) * 2, salt);
}

const BOLD_FLIRT_LINES: string[] = [
  "Uy, se siente el grupo caliente hoy 😏 ¿Quién se anima a mantener viva la conversación?",
  "A ver, sin vergüenza: ¿cuál es la fantasía más atrevida que se atreverían a confesar aquí? 😈",
  "Digan sin miedo qué cuerpo los vuelve locos: ¿culo, tetas, caderas o piernas? 🔥",
  "Les voy a ser directa: una buena nalga vale más que mil mensajes coquetos 💋",
  "Pregunta picante de la noche: ¿qué prefieren, videollamada a deshoras o contenido personalizado? 😏",
  "¿Quién aquí admite que le encanta una mujer con cuerpazo y actitud atrevida? 😈",
  "Nada como hablar claro: tetas o culazo, ¿de qué se acuerdan más después de una noche así? 🔥",
  "Si tuvieran una noche libre y sin límites, ¿qué posición probarían primero? 😏",
  "Hoy el tema es picante: ¿qué les llama más la atención, las curvas o la actitud? 💋",
  "Confiesen: ¿son de mandar fotos atrevidas o de recibir como un regalo? 😈",
  "Una cintura fina y un trasero bueno… díganme que no estoy exagerando 🔥",
  "¿A qué hora se despierta su lado más coqueto? Aquí la madrugada gana siempre 😏",
  "Cuéntenme qué detalle sensual les quita el sueño: ¿piernas, pies o una mirada provocadora? 💋",
  "¿Cuál es la posición que siempre quisieron probar y nunca se atrevieron? Sin juicios aquí 😈",
  "Lo dice Afrodita: una mujer sensual con confianza es el mejor espectáculo del grupo 🔥",
  "Pregunta coqueta para romper el hielo: ¿qué prefieren esta noche, sexting o videollamada? 😏",
  "A las valientes que comentan su fantasía favorita las adoro 💋 ¿Quién se suma?",
  "Domingo de confesiones: ¿qué contenido atrevido les gusta más, fotos, vídeos o llamadas en vivo? 😈",
];

/**
 * Línea conversacional atrevida para mantener la charla viva. General,
 * sin verificación y sin nombrar a nadie sin consentimiento.
 */
export function boldFlirtReply(
  randomValue = Math.random(),
  salt = "",
): string {
  const pool = BOLD_FLIRT_LINES;
  const offset = salt ? entertainmentSaltIndex(salt) % pool.length : 0;
  const base = Math.min(pool.length - 1, Math.max(0, Math.floor(randomValue * pool.length)));
  return pool[(base + offset) % pool.length]!;
}

/**
 * Mezcla catálogo original (≤0.5) con líneas atrevidas (≥0.5).
 * Para randomValue=0 devuelve exactamente catalogReply("general", 0).
 */
/**
 * Promoción personalizada atrevida sobre una verificada YA autorizada
 * (`authorizedProfiles` + `promotionConsents`). Usa su @username real si está
 * registrado; nunca inventa usernames. Sin salt, elige por `randomValue`.
 */
export function boldProfilePromotion(
  profile: { displayName: string; username?: string },
  randomValue = Math.random(),
  salt = "",
): string {
  const label = profile.username && /^[A-Za-z0-9_]{1,32}$/u.test(profile.username)
    ? `@${profile.username}`
    : plainProfileName(profile.displayName);
  if (!label) return "";
  const lines = [
    `Uy, ¿ya vieron a ${label}? 😏 Esa tiene unas curvas que no pasan desapercibidas. 🔥`,
    `${label} está dando de qué hablar hoy 😈 ¡Qué cuerpazo el que se gasta! 💋`,
    `A ver, ¿qué les llama más la atención de ${label}: las caderas, las piernas o esas curvas de película? 🔥`,
    `${label} no necesita permiso de nadie para lucirse 😏 ¡Qué nalgas y qué actitud!`,
    `Pregunta coqueta: ¿quién le ha escrito ya a ${label}? 😈 Esa sensualidad se nota a kilómetros. 🔥`,
    `Hoy toca destacar a ${label} 💋 Con esas piernas y ese cuerpazo, claro que enciende el grupo. 😏`,
    `${label} es de las que dejan a todos sin palabras 😈 Curvas, sonrisa coqueta y mucha actitud. 🔥`,
    `No se pueden ignorar las curvas de ${label} 💋 ¿Quién opina que es la más sensual del grupo? 😏`,
    `¿Ya vieron la actitud de ${label}? 😈 Caderas, piernas y un cuerpazo que enloquece. 🔥`,
    `${label} prende el grupo solo con aparecer 😏 ¡Qué nalgas, qué curvas, qué mujer! 💋`,
  ];
  const offset = salt ? entertainmentSaltIndex(salt) % lines.length : 0;
  const base = Math.min(lines.length - 1, Math.max(0, Math.floor(randomValue * lines.length)));
  return lines[(base + offset) % lines.length]!;
}

/**
 * Convierte un `randomValue` en un valor determinista variado por `salt`,
 * para alternar preguntas/opciones entre publicaciones sin cambiar firmas.
 */
export function saltedRandomValue(randomValue: number, salt: string): number {
  const hash = entertainmentSaltIndex(salt);
  const mixed = (randomValue + (hash % 997) / 997) % 1;
  return mixed < 0 ? mixed + 1 : mixed;
}

export function entertainmentLineReply(
  randomValue = Math.random(),
  salt = "",
): string {
  if (randomValue < 0.5) return catalogReply("general", randomValue * 2);
  return boldFlirtReply((randomValue - 0.5) * 2, salt);
}
