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
  const bank = [
    {
      question: "Si esta semana pudieran descubrir una recomendación local útil, ¿cuál elegirían?",
      options: [
        ["Un producto práctico para casa", "productos"],
        ["Un lugar rico para comer", "comida"],
        ["Un servicio que ahorre tiempo", "servicios"],
        ["Una idea sencilla para cuidarme", "bienestar"],
      ],
    },
    {
      question: "¿Qué dato les ayuda más antes de probar algo recomendado por la comunidad?",
      options: [
        ["Opiniones de quienes ya lo probaron", "general"],
        ["Qué problema o necesidad resuelve", "productos"],
        ["Cómo es la atención y la reserva", "servicios"],
        ["Precio y opciones disponibles", "productos"],
      ],
    },
    {
      question: "¿Qué plan local les vendría mejor para una tarde libre?",
      options: [
        ["Probar una cafetería o comida nueva", "comida"],
        ["Visitar una feria o tienda del barrio", "productos"],
        ["Hacer una actividad para desconectar", "bienestar"],
        ["Conocer un espacio de belleza o cuidado", "belleza"],
      ],
    },
    {
      question: "Al elegir un emprendimiento local, ¿qué les hace confiar más?",
      options: [
        ["Recomendaciones claras y honestas", "general"],
        ["Ver ejemplos reales del producto", "productos"],
        ["Saber quién presta el servicio", "servicios"],
        ["Una respuesta amable y rápida", "servicios"],
      ],
    },
    {
      question: "¿Qué pequeño descubrimiento mejoraría su rutina diaria?",
      options: [
        ["Un accesorio que sí resulte práctico", "moda"],
        ["Una comida rica cerca de casa", "comida"],
        ["Un consejo útil para el cabello o la piel", "belleza"],
        ["Una actividad para recargar energía", "bienestar"],
      ],
    },
    {
      question: "¿Qué recomendarían primero a alguien nuevo en el barrio?",
      options: [
        ["Su sitio favorito para comer", "comida"],
        ["Una tienda con buenos hallazgos", "productos"],
        ["Un servicio de confianza", "servicios"],
        ["Un plan tranquilo para el fin de semana", "bienestar"],
      ],
    },
    {
      question: "¿Qué hace que una recomendación de belleza sea realmente útil?",
      options: [
        ["Que explique para quién puede servir", "belleza"],
        ["Que cuente cómo se usa", "productos"],
        ["Que comparta una experiencia sincera", "general"],
        ["Que aclare el tiempo y el tipo de atención", "servicios"],
      ],
    },
    {
      question: "Si pudieran apoyar un negocio local hoy, ¿qué les gustaría encontrar?",
      options: [
        ["Algo artesanal o hecho en la zona", "productos"],
        ["Un menú con algo distinto", "comida"],
        ["Un servicio profesional recomendado", "servicios"],
        ["Ropa o accesorios con estilo propio", "moda"],
      ],
    },
  ] as const;
  const questionIndex = Math.min(
    bank.length - 1,
    Math.max(0, Math.floor(randomValue * bank.length)),
  );
  const selected = bank[questionIndex]!;
  const options = [...selected.options];
  if (topic !== "general") {
    const preferredIndex = options.findIndex(([, optionTopic]) => optionTopic === topic);
    if (preferredIndex > 0) options.unshift(...options.splice(preferredIndex, 1));
  }
  return {
    question: selected.question,
    options: options.map(([label]) => label),
    topics: options.map(([, optionTopic]) => optionTopic),
  };
}

export function verifiedModelsPollContent(
  topic: AfroditaTopic,
  models: readonly VerifiedModel[],
  randomValue = Math.random(),
): {
  question: string;
  options: string[];
  topics: AfroditaTopic[];
  subjectUserIds: number[];
  mentionedUserIds: number[];
} {
  if (models.length === 0) {
    return {
      ...pollContent(topic, randomValue),
      subjectUserIds: [],
      mentionedUserIds: [],
    };
  }
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
    subjectUserIds: uniqueModels.slice(0, 9).map((model) => model.userId),
    mentionedUserIds: uniqueModels
      .slice(0, 9)
      .filter((model) => model.username && /^[A-Za-z0-9_]{1,32}$/u.test(model.username))
      .map((model) => model.userId),
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
  options: { allowAdultContent?: boolean } = {},
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
  if (!options.allowAdultContent) {
    return `Estos perfiles tienen información pública disponible: ${list}${remaining}. Consulta únicamente lo que cada persona haya decidido compartir en su perfil.`;
  }
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
  const choices = !options.allowAdultContent && intent === "general"
    ? responses.general.slice(0, 3)
    : responses[intent];
  const index = Math.min(
    choices.length - 1,
    Math.max(0, Math.floor(randomValue * choices.length)),
  );
  return choices[index]!;
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

export function isAdultGeneratedReply(value: string): boolean {
  const normalized = normalizeForMatching(value);
  return /\b(?:sexo|sexual|fantasia|posiciones?|cuerpazo|culo|tetas?|nalgas?|senos?|vagina|sexting|desnudas?|picante|caliente|atrevid[oa]s?|sensual|curvas|coqueta|coqueto|erotico|erotica|contenido personalizado|fotos atrevidas|video jugueton)\b/u
    .test(normalized);
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
  { question: "En un coqueteo a distancia, ¿qué les resulta más excitante?", options: ["Mensajes sugerentes", "Audios con voz sensual", "Videollamada consensuada", "Una foto insinuante"] },
  { question: "¿Qué ritmo prefieren para una conversación subida de tono?", options: ["Insinuaciones poco a poco", "Ir al grano con respeto", "Bromas y doble sentido", "Que la otra persona marque el ritmo"] },
  { question: "¿Qué ambiente les pone más en modo cita íntima?", options: ["Luz tenue y música", "Una charla larga", "Un plan espontáneo", "Una cena tranquila"] },
  { question: "Al compartir contenido íntimo, ¿qué les parece más importante?", options: ["Consentimiento claro", "Privacidad", "Confianza mutua", "Poder decir que no"] },
  { question: "¿Qué tipo de mensaje coqueto les saca una sonrisa?", options: ["Un cumplido ingenioso", "Una invitación directa", "Un juego de preguntas", "Una nota de voz"] },
  { question: "¿Qué les atrae más en un encuentro entre adultos?", options: ["La complicidad", "La comunicación", "La confianza", "La espontaneidad"] },
  { question: "¿Qué prefieren para empezar una noche de pasión?", options: ["Besos y caricias", "Una conversación atrevida", "Un baile lento", "Dejar que fluya con acuerdo"] },
  { question: "Si hablan de fantasías, ¿qué tono prefieren?", options: ["Romántico", "Juguetón", "Directo", "Con humor"] },
  { question: "¿Qué detalle vuelve más sensual una videollamada consentida?", options: ["Una buena conversación", "Miradas y sonrisas", "Un ambiente cuidado", "Sentirse en confianza"] },
  { question: "¿Qué tipo de contenido adulto les despierta más curiosidad?", options: ["Relato erótico", "Audio sugerente", "Vídeo de baile sensual", "Fotografía artística"] },
  { question: "En una experiencia íntima, ¿qué disfrutan más?", options: ["Tomarse el tiempo", "Explorar algo nuevo", "Hablar de lo que gusta", "Reírse y relajarse"] },
  { question: "¿Qué estilo de seducción les convence más?", options: ["Seguro y directo", "Tierno y atento", "Juguetón y pícaro", "Misterioso y sutil"] },
  { question: "Para una noche especial entre adultos, ¿qué plan elegirían?", options: ["Cena y conversación", "Música y baile", "Un juego para dos", "Una sorpresa acordada"] },
  { question: "¿Qué postura clásica prefieren para empezar, siempre con comodidad?", options: ["Misionero", "De lado", "Vaquera", "Ir cambiando según el momento"] },
  { question: "¿Cómo prefieren marcar sus límites en una cita íntima?", options: ["Conversarlo antes", "Ir preguntando durante", "Usar una palabra acordada", "Cualquiera, si hay comunicación"] },
  { question: "¿Qué les parece más atractivo en una persona adulta?", options: ["Seguridad", "Sentido del humor", "Escucha y atención", "Confianza al comunicar"] },
  { question: "¿Qué formato de charla adulta prefieren a distancia?", options: ["Mensajes de texto", "Notas de voz", "Llamada privada", "Videollamada acordada"] },
  { question: "¿Qué hace que una fantasía compartida sea agradable para ambas personas?", options: ["Hablarlo con honestidad", "Acordar límites", "Respetar cualquier cambio de opinión", "Tener confianza"] },
  { question: "¿Qué les parece más seductor en una cita entre adultos?", options: ["Un cumplido sincero", "Una mirada cómplice", "Una invitación con confianza", "Una sorpresa conversada"] },
  { question: "¿Cómo prefieren expresar que algo les gusta?", options: ["Decirlo directamente", "Guiar con suavidad", "Preguntar y escuchar", "Compartirlo después"] },
  { question: "¿Qué plan les parece más tentador para una noche de pareja?", options: ["Baile lento en casa", "Un masaje acordado", "Una película y caricias", "Probar un juego de preguntas"] },
  { question: "¿Qué detalle mejora más una conversación íntima?", options: ["Escucha sin juzgar", "Humor compartido", "Interés mutuo", "Respeto por los límites"] },
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
): { question: string; options: string[]; topics: AfroditaTopic[]; adult: true } {
  const pool = ADULT_POLL_BANK;
  const offset = salt ? entertainmentSaltIndex(salt) % pool.length : 0;
  const base = Math.min(pool.length - 1, Math.max(0, Math.floor(randomValue * pool.length)));
  const poll = pool[(base + offset) % pool.length]!;
  return {
    question: poll.question,
    options: poll.options,
    topics: poll.options.map(() => "general"),
    adult: true,
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
  allowAdultContent = false,
): { question: string; options: string[]; topics: AfroditaTopic[]; adult?: true } {
  if (randomValue < 0.5) return pollContent(topic, randomValue * 2);
  if (!allowAdultContent) return pollContent(topic, (randomValue - 0.5) * 2);
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
  allowAdultContent = false,
): string {
  if (!allowAdultContent || randomValue < 0.5) return catalogReply("general", randomValue * 2);
  return boldFlirtReply((randomValue - 0.5) * 2, salt);
}
