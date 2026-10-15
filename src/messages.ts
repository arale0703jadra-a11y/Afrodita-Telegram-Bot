import type { AfroditaTopic } from "./types.js";

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

export function pollContent(topic: AfroditaTopic): {
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
  return {
    question: "¿Qué tipo de recomendación o negocio local les interesa descubrir?",
    options: ordered.map((candidate) => labels[candidate as keyof typeof labels]),
    topics: ordered,
  };
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
