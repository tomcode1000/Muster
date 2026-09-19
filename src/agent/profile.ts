/**
 * The parts of the check-in agent a customer may shape: its name, what it says
 * first, extra site instructions, and extra questions whose answers are
 * recorded as fields of their own.
 *
 * The rules that keep recorded facts accurate are not here. They live in the
 * prompt builder and cannot be edited, so no configuration can make Muster
 * record something the foreman did not say.
 */

export type AnswerType = "yes_no" | "number" | "text";

export interface ExtraQuestion {
  id: string;
  text: string;
  answerType: AnswerType;
}

export interface AgentProfile {
  name: string;
  greetingEn: string;
  greetingEs: string;
  instructions: string;
  questions: ExtraQuestion[];
}

export const PLACEHOLDERS = [
  "agent",
  "foreman",
  "first_name",
  "company",
  "work",
  "area",
  "start",
  "superintendent",
  "project",
] as const;

export type TemplateValues = Record<(typeof PLACEHOLDERS)[number], string>;

export const DEFAULT_PROFILE: AgentProfile = {
  name: "Muster",
  greetingEn: "Hi {first_name}, it's {agent} calling for {superintendent} on {project}. You're down for {area} tomorrow at {start}. Still on?",
  greetingEs: "Hola {first_name}, habla {agent} de parte de {superintendent}, para {project}. Le tengo en {area} mañana a las {start}. ¿Sigue en pie?",
  instructions: "",
  questions: [],
};

export const LIMITS = {
  name: 40,
  greeting: 300,
  instructions: 2000,
  questions: 10,
  questionText: 200,
};

const ANSWER_TYPES: AnswerType[] = ["yes_no", "number", "text"];

/** Fills {placeholders}. Unknown ones are left as written; validation catches them on save. */
export function renderTemplate(template: string, values: TemplateValues): string {
  return template.replace(/\{([a-z_]+)\}/g, (whole, key: string) =>
    key in values ? values[key as keyof TemplateValues] : whole,
  );
}

export function unknownPlaceholders(template: string): string[] {
  const known = new Set<string>(PLACEHOLDERS);
  return [...template.matchAll(/\{([^}]*)\}/g)].map((m) => m[1]).filter((k) => !known.has(k));
}

function slug(s: string) {
  return s.toLowerCase().normalize("NFKD").replace(/[^\w\s]/g, "").trim().replace(/\s+/g, "_").slice(0, 40) || "question";
}

export function validateProfile(input: any): { profile: AgentProfile; errors: string[] } {
  const errors: string[] = [];
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const d = DEFAULT_PROFILE;

  const name = str(input?.name) || d.name;
  if (name.length > LIMITS.name) errors.push(`Agent name must be ${LIMITS.name} characters or fewer`);
  if (/[{}]/.test(name)) errors.push("Agent name cannot contain braces");

  const greetings: [string, string][] = [
    ["English greeting", str(input?.greetingEn) || d.greetingEn],
    ["Spanish greeting", str(input?.greetingEs) || d.greetingEs],
  ];
  for (const [label, text] of greetings) {
    if (text.length > LIMITS.greeting) errors.push(`${label} must be ${LIMITS.greeting} characters or fewer`);
    const unknown = unknownPlaceholders(text);
    if (unknown.length) {
      errors.push(`${label} uses unknown ${unknown.length === 1 ? "fill-in" : "fill-ins"} ${unknown.map((u) => `{${u}}`).join(", ")}`);
    }
  }

  const instructions = str(input?.instructions);
  if (instructions.length > LIMITS.instructions) errors.push(`Extra instructions must be ${LIMITS.instructions} characters or fewer`);

  const rawQuestions: any[] = Array.isArray(input?.questions) ? input.questions : [];
  if (rawQuestions.length > LIMITS.questions) errors.push(`At most ${LIMITS.questions} extra questions`);
  const questions: ExtraQuestion[] = [];
  const ids = new Set<string>();
  for (const q of rawQuestions.slice(0, LIMITS.questions)) {
    const text = str(q?.text);
    if (!text) continue;
    if (text.length > LIMITS.questionText) errors.push(`Question "${text.slice(0, 30)}" is too long`);
    const answerType: AnswerType = ANSWER_TYPES.includes(q?.answerType) ? q.answerType : "text";
    // Keep an existing id so answers stay linked when the wording is edited.
    let id = /^[a-z0-9_]{1,40}$/.test(q?.id ?? "") ? q.id : slug(text);
    for (let n = 2; ids.has(id); n++) id = `${slug(text).slice(0, 36)}_${n}`;
    ids.add(id);
    questions.push({ id, text, answerType });
  }

  return {
    profile: { name, greetingEn: greetings[0][1], greetingEs: greetings[1][1], instructions, questions },
    errors,
  };
}
