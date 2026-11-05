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

export type ScheduledPollTheme = "intimacy" | "market";

export interface ScheduledPollContent {
  question: string;
  options: string[];
  topics: AfroditaTopic[];
  templateId: string;
  pollTheme?: ScheduledPollTheme;
  adult?: true;
}

interface ScheduledPollTemplate {
  id: string;
  question: string;
  options: string[];
}

const SCHEDULED_INTIMACY_POLLS: ScheduledPollTemplate[] = [
  { id: "intimacy-interest-format", question: "¿Qué formato de contenido para adultos despierta más tu interés, sin necesidad de compartir detalles personales?", options: ["Fotografías sugerentes 📸", "Videos eróticos no gráficos 🔥", "Contenido personalizado 💋", "Prefiero no consumir contenido adulto"] },
  { id: "intimacy-attraction", question: "Entre personas adultas, ¿qué suele despertar primero tu atracción?", options: ["La seguridad al expresarse ✨", "El sentido del humor 😏", "La química al conversar 💬", "La complicidad y el respeto 💜"] },
  { id: "intimacy-fantasy-consent", question: "Al explorar una fantasía consensuada entre adultos, ¿qué te parece más importante?", options: ["Hablarla con claridad 🗣️", "Acordar límites antes 🔒", "Poder cambiar de opinión 💜", "Sentirse en confianza ❤️"] },
  { id: "intimacy-relationship", question: "En una relación íntima entre adultos, ¿qué ayuda más a que ambas personas disfruten?", options: ["Comunicación honesta ❤️", "Confianza mutua 🔐", "Atracción y química 🔥", "Respeto por los límites 💜"] },
  { id: "intimacy-erotic-content", question: "¿Qué estilo de contenido erótico prefieres cuando decides consumirlo?", options: ["Sugerente y artístico 🎨", "Romántico y cercano 💞", "Directo, pero no gráfico 🔥", "No suelo consumirlo 🌿"] },
  { id: "intimacy-private-chat", question: "En una conversación íntima privada entre adultos, ¿qué tono te resulta más cómodo?", options: ["Coqueto y juguetón 😏", "Claro y directo 💬", "Romántico y atento ❤️", "Prefiero mantenerla casual 🌿"] },
  { id: "intimacy-boundaries", question: "¿Qué forma de comunicar un límite en una situación íntima te parece más cómoda?", options: ["Decirlo claramente 🗣️", "Acordarlo antes de empezar 📝", "Preguntar durante la experiencia 💬", "Cualquiera, si se respeta de inmediato 💜"] },
  { id: "intimacy-chemistry", question: "¿Qué te hace notar más la química con otra persona adulta?", options: ["Una conversación que fluye 💬", "La atracción mutua 🔥", "Sentirse escuchado y respetado 💜", "El humor compartido 😄"] },
  { id: "intimacy-distance", question: "Para mantener la cercanía íntima a distancia, ¿qué formato consensuado prefieres?", options: ["Mensajes sugerentes 💌", "Audios con voz sensual 🎧", "Una llamada privada 📞", "No me interesa ese formato 🌿"] },
  { id: "intimacy-seduction", question: "¿Qué estilo de coqueteo entre adultos te resulta más atractivo?", options: ["Seguro y respetuoso ✨", "Juguetón y con humor 😏", "Sutil y gradual 🌙", "Directo, preguntando primero 💬"] },
  { id: "intimacy-comfort", question: "¿Qué contribuye más a sentirse a gusto al compartir intimidad con otra persona adulta?", options: ["Confianza y comunicación ❤️", "Privacidad y discreción 🔒", "Atracción y química 🔥", "Respeto mutuo 💜"] },
  { id: "intimacy-romance", question: "¿Qué ambiente consensuado te parece más atractivo para una cita íntima adulta?", options: ["Luz tenue y música 🎶", "Una charla sin prisas 💬", "Un plan espontáneo ✨", "Un espacio privado y cómodo 🔒"] },
  { id: "intimacy-erotic-story", question: "Si eliges contenido erótico, ¿qué estilo narrativo te atrae más?", options: ["Romántico y emocional 💞", "Juguetón y ligero 😏", "Misterioso y sugerente 🌙", "Prefiero otros formatos 🎥"] },
  { id: "intimacy-mutual-interest", question: "¿Qué señal te parece más importante para saber que el interés íntimo es mutuo?", options: ["Una conversación clara 💬", "Iniciativa recíproca ✨", "Preguntar y escuchar ❤️", "Acordar los límites con calma 💜"] },
  { id: "intimacy-private-content", question: "Al consumir contenido íntimo de adultos, ¿qué valoras más además del tema?", options: ["Que sea compartido con consentimiento ✅", "Que cuide la privacidad 🔒", "Que tenga un estilo auténtico ✨", "No consumo ese contenido 🌿"] },
  { id: "intimacy-fantasy-tone", question: "¿Qué tono prefieres en una fantasía adulta compartida de forma consensuada?", options: ["Romántico 💞", "Travieso y divertido 😏", "Sensual y sugerente 🔥", "Conversado y con límites claros 💜"] },
  { id: "intimacy-communication", question: "¿Qué conversación te parece más útil antes de una experiencia íntima entre adultos?", options: ["Qué desea cada persona 💬", "Qué límites hay que respetar 🔒", "Qué nivel de privacidad esperan 🔐", "Todo lo anterior, sin presión ❤️"] },
  { id: "intimacy-attraction-style", question: "¿Qué rasgo te resulta más atractivo en otra persona adulta?", options: ["Confianza en sí misma ✨", "Atención y escucha ❤️", "Espontaneidad con respeto 😄", "Claridad al comunicar 💬"] },
  { id: "intimacy-content-mood", question: "¿En qué momento te interesaría más explorar contenido erótico consensuado?", options: ["Cuando busco algo romántico 💞", "Para una ocasión especial ✨", "Por curiosidad personal 👀", "No suele interesarme 🌿"] },
  { id: "intimacy-consent-change", question: "¿Qué debería ocurrir si alguien cambia de opinión durante un momento íntimo?", options: ["Parar y conversar 💬", "Respetar el cambio sin insistir 💜", "Tomarse un espacio si lo necesita 🌿", "Cualquiera de estas opciones, según la persona ❤️"] },
  { id: "intimacy-private-media", question: "¿Qué te da más tranquilidad al compartir contenido íntimo consensuado entre adultos?", options: ["Acuerdos claros sobre su uso 📝", "Privacidad y discreción 🔒", "Poder retirar el consentimiento 💜", "No compartir contenido personal 🌿"] },
  { id: "intimacy-attraction-connection", question: "¿Qué combina mejor con la atracción física para construir una conexión íntima?", options: ["Confianza ❤️", "Comunicación directa 💬", "Humor y complicidad 😄", "Respeto por los tiempos 💜"] },
  { id: "intimacy-creator-content", question: "Al elegir contenido erótico para adultos, ¿qué estilo prefieres?", options: ["Casero y auténtico ✨", "Producción cuidada 🎬", "Personalizado según preferencias 💌", "Ninguno; no consumo contenido adulto 🌿"] },
  { id: "intimacy-privacy-choice", question: "¿Qué nivel de privacidad prefieres al explorar temas íntimos en línea?", options: ["Solo contenido público y general 🌐", "Espacios privados con reglas claras 🔒", "No compartir información personal 🛡️", "Prefiero no tratarlo en línea 🌿"] },
  { id: "intimacy-desire-talk", question: "¿Qué facilita hablar sobre gustos íntimos con una pareja adulta?", options: ["Elegir un momento tranquilo 🌙", "Hablar sin juzgar ❤️", "Preguntar antes de asumir 💬", "Dejar claro que nadie tiene que responder 💜"] },
  { id: "intimacy-erotic-audio", question: "Si eliges contenido erótico en audio, ¿qué detalle prefieres?", options: ["Una voz cálida 🎧", "Una historia sugerente 📖", "Un tono espontáneo ✨", "No suelo escuchar ese formato 🌿"] },
  { id: "intimacy-physical-first-look", question: "En una primera impresión entre adultos, ¿qué detalle físico suele llamar más tu atención?", options: ["Una mirada intensa 👀", "Una sonrisa irresistible 😏", "Unas piernas bonitas 🔥", "Un estilo que tenga actitud ✨"] },
  { id: "intimacy-body-style", question: "Cuando sientes atracción por otra persona adulta, ¿qué rasgo te parece más atractivo?", options: ["Un buen escote 😏", "Un trasero que destaque 🍑", "Una silueta elegante ✨", "La seguridad con que se expresa 🔥"] },
  { id: "intimacy-attraction-energy", question: "¿Qué mezcla de actitud y estilo te resulta más atractiva en una persona adulta?", options: ["Mirada coqueta y sonrisa 👀", "Confianza y buen humor 😏", "Elegancia con un toque atrevido 💋", "Naturalidad y complicidad ❤️"] },
  { id: "intimacy-couple-dynamic", question: "En un momento íntimo consensuado en pareja, ¿qué dinámica te atrae más?", options: ["Tomar la iniciativa 🔥", "Turnarse y sorprenderse 👀", "Jugar y reírse juntos 😏", "Ir con calma y hablarlo ❤️"] },
  { id: "intimacy-couple-pace", question: "¿Qué ritmo prefieres para crear tensión romántica entre adultos?", options: ["Coqueteo lento y miradas 👀", "Una invitación directa 😏", "Sorpresas acordadas 🔥", "Conversar y ver qué apetece 💜"] },
  { id: "intimacy-couple-surprise", question: "¿Qué sorpresa consensuada te parece más tentadora en una cita adulta?", options: ["Un plan romántico inesperado ❤️", "Un mensaje coqueto durante el día 💌", "Un look especial para la ocasión ✨", "Elegir juntos el plan 😏"] },
  { id: "intimacy-couple-initiation", question: "¿Qué te parece más atractivo cuando hay interés mutuo entre adultos?", options: ["Que alguien dé el primer paso 🔥", "Las señales coquetas de ambos 👀", "Una invitación clara y respetuosa 💬", "Dejar que la química marque el ritmo ❤️"] },
  { id: "intimacy-fantasy-setting", question: "Si compartieras una fantasía consensuada con otra persona adulta, ¿qué ambiente elegirías?", options: ["Una escapada romántica 🌙", "Una cita con mucho coqueteo 😏", "Un plan espontáneo y divertido ✨", "Algo íntimo hablado de antemano 💜"] },
  { id: "intimacy-erotic-photo", question: "¿Qué estilo de fotografía sugerente para adultos te parece más atractivo?", options: ["Retratos con una mirada intensa 👀", "Una sesión elegante y artística 🎨", "Un toque juguetón y coqueto 😏", "Prefiero no consumir contenido adulto 🌿"] },
  { id: "intimacy-erotic-video", question: "Al elegir videos eróticos para adultos, ¿qué estilo prefieres?", options: ["Una historia romántica 💞", "Un tono sensual y sugerente 🔥", "Algo espontáneo y auténtico ✨", "No suelo ver ese contenido 🌿"] },
  { id: "intimacy-content-exclusive", question: "¿Qué te gustaría encontrar en contenido adulto exclusivo?", options: ["Fotos atrevidas y cuidadas 📸", "Videos eróticos 🎥", "Una propuesta personalizada 💋", "Una combinación variada 🔥"] },
  { id: "intimacy-content-creator-style", question: "¿Qué estilo de una creadora adulta te despierta más curiosidad?", options: ["Glamuroso y elegante ✨", "Coqueto y divertido 😏", "Sensual y sugerente 🔥", "Cercano y auténtico 💜"] },
  { id: "intimacy-private-format", question: "Si eliges contenido adulto personalizado, ¿qué formato te llama más?", options: ["Una sesión de fotos 📸", "Un video con una idea acordada 🎥", "Un audio coqueto 🎧", "Prefiero contenido general 🌿"] },
  { id: "intimacy-romantic-sexual-style", question: "¿Qué combinación te parece más atractiva en una relación adulta?", options: ["Romance con un toque picante ❤️🔥", "Humor y coqueteo 😏", "Confianza y espontaneidad ✨", "Comunicación directa y cariño 💜"] },
  { id: "intimacy-boundary-flirt", question: "¿Qué hace que un coqueteo entre adultos se sienta atrevido y cómodo a la vez?", options: ["Interés mutuo 👀", "Preguntar y respetar los límites 💜", "Humor y complicidad 😏", "Poder decir que no sin presión 🌿"] },
];

const SCHEDULED_MARKET_POLLS: ScheduledPollTemplate[] = [
  { id: "market-trust-before-buy", question: "¿Qué te daría más confianza antes de comprar contenido exclusivo para adultos?", options: ["Ver un perfil verificado ✅", "Conocer exactamente qué incluye 📋", "Leer referencias auténticas ⭐", "Usar un método de pago seguro 🔒"] },
  { id: "market-custom-content", question: "Al comprar contenido personalizado para adultos, ¿qué aspecto considerarías más importante?", options: ["Que respete tus preferencias 💜", "Que sea realmente exclusivo ✨", "Que tenga buena calidad 🎥", "Acordar condiciones antes 📝"] },
  { id: "market-creator-choice", question: "¿Qué valoras más al elegir a una creadora adulta?", options: ["Su estilo y propuesta 🎨", "La calidad de sus publicaciones 🎬", "Su autenticidad ✨", "La claridad de las condiciones 📋"] },
  { id: "market-subscription", question: "¿Qué modalidad de acceso a contenido adulto prefieres?", options: ["Compra individual 💳", "Suscripción mensual 🔐", "Contenido exclusivo por encargo 💌", "No suelo pagar por este contenido 🌿"] },
  { id: "market-security", question: "¿Qué te preocupa más al comprar contenido digital para adultos?", options: ["La privacidad de mis datos 🔒", "La seguridad del pago 🛡️", "Recibir lo que se anunció 📋", "El uso posterior del contenido 💜"] },
  { id: "market-format", question: "Si decides comprar contenido adulto, ¿qué formato te interesa más?", options: ["Sets de fotografías 📸", "Videos 🎥", "Audios o relatos 🎧", "Contenido personalizado 💌"] },
  { id: "market-price-clarity", question: "¿Qué información debería estar clara antes de pagar por contenido exclusivo para adultos?", options: ["Precio total y método de pago 💳", "Formato y cantidad incluidos 📋", "Si hay renovación automática 🔁", "Política de privacidad 🔒"] },
  { id: "market-creator-conditions", question: "Para quien crea y vende contenido adulto digital, ¿qué condición protege mejor a ambas partes?", options: ["Alcance del encargo por escrito 📝", "Pago y entrega acordados 💳", "Límites de uso definidos 🔒", "Comunicación respetuosa 💜"] },
  { id: "market-exclusive", question: "¿Qué te haría considerar una suscripción a contenido adulto exclusivo?", options: ["Publicaciones nuevas con frecuencia 🗓️", "Un estilo que realmente me interesa ✨", "Condiciones fáciles de cancelar 🔓", "Prefiero compras puntuales 💳"] },
  { id: "market-subscription-creator", question: "¿Qué te animaría a suscribirte al contenido de una creadora adulta?", options: ["Un estilo que encaje con mis gustos ✨", "Novedades exclusivas con regularidad 🔥", "Una suscripción fácil de cancelar 🔓", "Prefiero compras puntuales 💳"] },
  { id: "market-content-menu", question: "¿Qué variedad te gustaría ver en una oferta de contenido adulto?", options: ["Sets de fotos sugerentes 📸", "Videos exclusivos 🎥", "Pedidos personalizados 💋", "Una mezcla de formatos 🔥"] },
  { id: "market-buyer-experience", question: "¿Qué hace que una compra de contenido adulto sea una buena experiencia?", options: ["Recibir lo que se describió 📋", "Privacidad durante el proceso 🔒", "Condiciones claras desde el inicio ✅", "Un trato respetuoso 💜"] },
  { id: "market-creator-boundaries", question: "Para una creadora adulta, ¿qué límite debería quedar claro antes de aceptar un pedido?", options: ["Qué tipo de contenido se hará 💬", "Qué usos se permiten 🔒", "Precio y plazo de entrega 💳", "Todo lo anterior, acordado con claridad ✅"] },
  { id: "market-creator-format", question: "Si crearas contenido adulto, ¿qué formato te interesaría ofrecer?", options: ["Fotografías con estilo propio 📸", "Videos exclusivos 🎥", "Contenido personalizado 💌", "Una suscripción con varias opciones 🔐"] },
  { id: "market-custom-brief", question: "Antes de encargar contenido personalizado para adultos, ¿qué conviene acordar?", options: ["La idea y el formato 📝", "El precio y la entrega 💳", "Los límites de uso 🔒", "Todo, sin dejar dudas ✅"] },
  { id: "market-privacy-choice", question: "Al suscribirte a contenido adulto, ¿qué detalle de privacidad valoras más?", options: ["Que el pago sea discreto 🔒", "Que no compartan mis datos 🛡️", "Poder cancelar fácilmente 🔓", "Saber cómo se protege mi cuenta ✅"] },
  { id: "market-exclusive-choice", question: "¿Qué tipo de acceso a contenido adulto exclusivo te atrae más?", options: ["Una compra única 💳", "Una suscripción mensual 🔐", "Un pedido personalizado 💌", "Solo contenido gratuito 🌿"] },
];

const SCHEDULED_GENERAL_POLLS: ScheduledPollTemplate[] = [
  { id: "general-kindness", question: "¿Qué ayuda más a que una comunidad en línea sea agradable para todos?", options: ["Respeto al conversar 💬", "Privacidad de cada persona 🔒", "Humor sin atacar a nadie 😄", "Poder participar sin presión 🌿"] },
  { id: "general-free-time", question: "Cuando tienes un rato libre, ¿qué plan sencillo prefieres?", options: ["Escuchar música 🎧", "Ver una película 🎬", "Salir a caminar 🌳", "Descansar en casa ☕"] },
  { id: "general-recommendation", question: "¿Qué hace que una recomendación de la comunidad te resulte útil?", options: ["Que sea sincera ✨", "Que explique la experiencia 📋", "Que respete distintos gustos 💜", "Que no presione a comprar 🌿"] },
  { id: "general-chat", question: "¿Qué tema ligero te gusta para iniciar una conversación?", options: ["Viajes y lugares 🌍", "Música y series 🎶", "Comida favorita 🍰", "Ideas para el fin de semana ☀️"] },
  { id: "general-community", question: "¿Qué detalle mejora más la convivencia en un grupo?", options: ["Escuchar antes de responder 👂", "Evitar compartir datos ajenos 🔒", "Dar espacio a distintas opiniones 💬", "Mantener un tono amable ❤️"] },
  { id: "general-learning", question: "¿Qué habilidad te gustaría aprender por curiosidad?", options: ["Cocinar algo nuevo 🍳", "Tomar mejores fotografías 📸", "Aprender un idioma 🌎", "Tocar un instrumento 🎸"] },
  { id: "general-weekend", question: "¿Cuál sería tu plan ideal para un día libre?", options: ["Una salida tranquila 🌿", "Una tarde de series 🎬", "Probar un lugar nuevo 🍽️", "Descansar sin horarios ☁️"] },
  { id: "general-digital-safety", question: "¿Qué hábito te ayuda más a sentirte seguro en internet?", options: ["Usar contraseñas distintas 🔐", "Revisar antes de compartir 🛡️", "Cuidar la información personal 🔒", "Pedir permiso antes de publicar fotos ✅"] },
  { id: "general-mood", question: "¿Qué suele mejorar tu ánimo en un día complicado?", options: ["Hablar con alguien de confianza 💬", "Salir un momento al aire libre 🌳", "Escuchar algo que te gusta 🎶", "Tomarte una pausa ☕"] },
  { id: "general-entertainment", question: "¿Qué formato de entretenimiento eliges con más frecuencia?", options: ["Películas o series 🎬", "Podcasts y audio 🎧", "Libros o relatos 📚", "Videos cortos 📱"] },
];

function chooseScheduledTemplate(
  templates: readonly ScheduledPollTemplate[],
  randomValue: number,
  salt: string,
  recentTemplateIds: readonly string[],
): ScheduledPollTemplate {
  const recent = new Set(recentTemplateIds);
  const start = Math.min(
    templates.length - 1,
    Math.floor(Math.min(0.999999, Math.max(0, randomValue)) * templates.length),
  );
  const saltOffset = salt ? entertainmentSaltIndex(salt) % templates.length : 0;
  for (let offset = 0; offset < templates.length; offset += 1) {
    const candidate = templates[(start + saltOffset + offset) % templates.length]!;
    if (!recent.has(candidate.id)) return candidate;
  }
  return templates[(start + saltOffset) % templates.length]!;
}

export function scheduledAdultPollTheme(
  recentThemes: readonly ScheduledPollTheme[],
): ScheduledPollTheme {
  const recent = recentThemes.slice(-10);
  if (recent.length < 10) {
    const targetMarket = Math.floor((recent.length + 1) * 0.3);
    const currentMarket = recent.filter((theme) => theme === "market").length;
    return currentMarket < targetMarket ? "market" : "intimacy";
  }
  return recent.filter((theme) => theme === "market").length < 3
    ? "market"
    : "intimacy";
}

export function scheduledPollContent(
  topic: AfroditaTopic,
  allowAdultContent: boolean,
  randomValue = Math.random(),
  salt = "",
  recentTemplateIds: readonly string[] = [],
  recentThemes: readonly ScheduledPollTheme[] = [],
): ScheduledPollContent {
  const theme = allowAdultContent
    ? scheduledAdultPollTheme(recentThemes)
    : undefined;
  const templates = theme === "intimacy"
    ? SCHEDULED_INTIMACY_POLLS
    : theme === "market"
      ? SCHEDULED_MARKET_POLLS
      : SCHEDULED_GENERAL_POLLS;
  const selected = chooseScheduledTemplate(
    templates,
    randomValue,
    salt,
    recentTemplateIds,
  );
  return {
    question: selected.question,
    options: selected.options,
    topics: selected.options.map(() => topic),
    templateId: selected.id,
    ...(theme ? { pollTheme: theme, adult: true as const } : {}),
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
 * Presentación juguetona de un perfil autorizado sin atribuirle rasgos físicos
 * ni convertir su username en una insinuación sexual.
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
    `🔥 Hay perfil verificado nuevo en el radar: ${label} 😏 Descubre lo que decidió compartir; con respeto, siempre 💋`,
    `👀 Pausa el scroll: ${label} tiene un perfil autorizado para este grupo. Curiosea sin presión y con buena onda 💜`,
    `😏 Novedad para descubrir: ${label} cuenta con perfil verificado aquí. La curiosidad sí; invadir la privacidad, no 🔒`,
    `💋 Se suma un perfil al radar del grupo: ${label}. Pasa a conocer su espacio y respeta sus límites ✨`,
    `🔥 ¿Quién anda con curiosidad? ${label} tiene un perfil verificado autorizado. Un saludo amable siempre suma 😏`,
    `👀 Hay novedad por aquí: ${label} decidió compartir su perfil verificado. Descúbrelo a tu ritmo 💜`,
    `✨ El radar suma un perfil verificado: ${label}. Mira solo lo que eligió publicar y mantén la buena vibra 😏`,
    `😈 No prometemos chisme, pero sí novedad: ${label} tiene perfil autorizado para este grupo. Pasen con respeto 💋`,
    `💜 Una nueva presentación para animar el ambiente: ${label}, con perfil verificado y autorización vigente 👀`,
    `🔥 Se abre una nueva opción para descubrir: ${label} cuenta con perfil verificado aquí. Sin presión, con respeto 😏`,
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
