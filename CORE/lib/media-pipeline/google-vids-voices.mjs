export const GOOGLE_VIDS_VOICE_CATALOG_SCHEMA = "google-vids-voice-catalog@1";
export const GOOGLE_VIDS_VOICE_CATALOG_OBSERVED_AT = "2026-08-12";

const natural = [
  ["Nyla", "Leve, mais aguda"],
  ["Elio", "Amigável, tom médio-grave"],
  ["Knox", "Suave, tom grave"],
  ["Jett", "Rouca, tom grave"],
  ["Zeno", "Firme, tom médio-grave"],
  ["Tova", "Descontraída, tom médio"],
  ["Kaci", "Aberta, tom médio"],
  ["Lani", "Relaxada, tom médio"],
  ["Holt", "Informativa, tom grave"],
  ["Lora", "Suave, tom médio"],
  ["Paz", "Sussurrada, tom grave"],
  ["Tyra", "Clara, tom médio"],
  ["Kero", "Vibrante, tom médio-grave"],
  ["Saro", "Madura, tom médio"],
  ["Nyx", "Clara, tom médio-grave"],
  ["Lito", "Firme, tom médio"],
  ["Peli", "Animada, mais aguda"],
  ["Fira", "Jovial, mais aguda"],
  ["Cale", "Firme, tom médio-grave"],
  ["Neo", "Animada, tom médio"],
  ["Vira", "Projetada, tom médio"],
  ["Iro", "Informativa, tom médio"],
  ["Dori", "Expressiva, tom grave"],
  ["Umi", "Confiante, tom médio"],
  ["Jacy", "Equilibrada, tom médio-grave"],
  ["Fola", "Acolhedora, tom médio"],
  ["Baya", "Relaxada, tom médio-grave"],
  ["Orla", "Delicada, tom médio"],
  ["Sani", "Aberta, mais aguda"],
  ["Yori", "Casual, tom médio-grave"],
];

const classic = [
  ["Narrador", "Suave, tom médio"],
  ["Educador", "Amigável, mais aguda"],
  ["Professor", "Clara, tom grave"],
  ["Persuasiva", "Envolvente, tom grave"],
  ["Explicativa", "Animada, tom grave"],
  ["Treinador", "Animada, mais aguda"],
  ["Motivador", "Enérgica, tom médio"],
];

export const GOOGLE_VIDS_VOICES = Object.freeze([
  ...natural.map(([name, description]) => Object.freeze({ name, description, group: "natural", engine: "Gemini 3.1 Flash" })),
  ...classic.map(([name, description]) => Object.freeze({ name, description, group: "classic", engine: "Google Vids" })),
]);

const VOICE_ALIASES = Object.freeze({
  jeff: "Jett",
  jeet: "Jett",
  helio: "Elio",
});

function comparable(value) {
  return String(value ?? "").trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
}

export function resolveGoogleVidsVoice(value = "Nyla") {
  const rawRequested = comparable(value);
  const canonicalName = VOICE_ALIASES[rawRequested] ?? value;
  const requested = comparable(canonicalName);
  const voice = GOOGLE_VIDS_VOICES.find((entry) => comparable(entry.name) === requested);
  if (!voice) {
    throw new Error(`Voz Google Vids desconhecida: ${String(value)}. Use \`npm run video -- voices --provider google-vids\` para listar as opções.`);
  }
  return voice;
}

export function listGoogleVidsVoices({ group = null, query = null } = {}) {
  const normalizedGroup = group == null ? null : comparable(group);
  if (normalizedGroup && !new Set(["natural", "classic", "classica", "classico"]).has(normalizedGroup)) {
    throw new Error("--group deve ser natural ou classic.");
  }
  const canonicalGroup = normalizedGroup === "natural" ? "natural" : normalizedGroup ? "classic" : null;
  const normalizedQuery = comparable(query);
  return GOOGLE_VIDS_VOICES.filter((voice) => {
    if (canonicalGroup && voice.group !== canonicalGroup) return false;
    if (!normalizedQuery) return true;
    return comparable(`${voice.name} ${voice.description} ${voice.group} ${voice.engine}`).includes(normalizedQuery);
  });
}

export function googleVidsVoiceCatalog(options = {}) {
  const voices = listGoogleVidsVoices(options);
  return {
    schema: GOOGLE_VIDS_VOICE_CATALOG_SCHEMA,
    provider: "google-vids",
    source: "authenticated-ui-observation",
    observedAt: GOOGLE_VIDS_VOICE_CATALOG_OBSERVED_AT,
    dynamicProviderCatalog: true,
    total: voices.length,
    voices,
  };
}
