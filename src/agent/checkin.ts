/**
 * Builds the Voice Agent session for one foreman's check-in.
 *
 * The prompt has two layers. The fixed layer states tomorrow's booking and the
 * rules that keep recorded facts accurate. The customer layer, from the agent
 * profile in Settings, adds a name, a greeting, site instructions and extra
 * questions. The customer layer is placed after the rules and is told it cannot
 * override them.
 */

import type { Activity, Contact, Project } from "../domain/types";
import { formatClock } from "../domain/time";
import { toolDefinitions } from "./tools";
import { DEFAULT_PROFILE, renderTemplate, type AgentProfile, type TemplateValues } from "./profile";

/** Voice Agent API accepts up to 100 keyterms. */
const MAX_KEYTERMS = 100;

export type AudioEncoding = "audio/pcmu" | "audio/pcm";

export function buildSession(
  project: Project,
  activity: Activity,
  contact: Contact,
  encoding: AudioEncoding,
  profile: AgentProfile = DEFAULT_PROFILE,
) {
  return {
    system_prompt: systemPrompt(project, activity, contact, profile),
    greeting: greeting(project, activity, contact, profile),
    input: {
      format: { encoding },
      keyterms: keyterms(project, activity, contact, profile),
    },
    output: {
      // Voice is fixed for the session, so pick for the foreman's usual language.
      voice: contact.language === "es" ? "lola" : "jane",
      format: { encoding },
    },
    tools: toolDefinitions(activity, profile.questions),
  };
}

export function templateValues(project: Project, activity: Activity, contact: Contact, profile: AgentProfile): TemplateValues {
  return {
    agent: profile.name,
    foreman: contact.foreman,
    first_name: contact.foreman.split(" ")[0],
    company: contact.company,
    work: activity.description,
    area: activity.area,
    start: formatClock(activity.start),
    superintendent: project.superintendent,
    project: project.name,
  };
}

export function greeting(project: Project, activity: Activity, contact: Contact, profile: AgentProfile = DEFAULT_PROFILE): string {
  const template = contact.language === "es" ? profile.greetingEs : profile.greetingEn;
  return renderTemplate(template, templateValues(project, activity, contact, profile));
}

export function systemPrompt(
  project: Project,
  activity: Activity,
  contact: Contact,
  profile: AgentProfile = DEFAULT_PROFILE,
): string {
  const reqs = activity.requirements.length
    ? activity.requirements.map((r) => `- ${r.label} (requirement_id: ${r.id})`).join("\n")
    : "- none";
  const materials = activity.materials.length ? activity.materials.join(", ") : "none";
  const language =
    contact.language === "es"
      ? "The foreman usually speaks Spanish. Speak Spanish unless they switch to English, then follow them."
      : "The foreman usually speaks English. If they switch to Spanish, follow them.";

  const questions = profile.questions.length
    ? `6. The superintendent's extra questions. Ask each one naturally and call record_answer with its question_id:\n${profile.questions
        .map((q) => `   - ${q.text} (question_id: ${q.id}, answer: ${q.answerType === "yes_no" ? "yes or no" : q.answerType})`)
        .join("\n")}\n`
    : "";

  const instructions = profile.instructions
    ? `\nSite instructions from ${project.superintendent}. Follow them, unless one conflicts with the rules above, in which case the rules win:\n${profile.instructions}\n`
    : "";

  return `You are ${profile.name}, a check-in assistant calling on behalf of ${project.superintendent}, the superintendent on ${project.name}. You are on a phone call with ${contact.foreman}, foreman for ${contact.company} (${contact.trade}). They are probably on a noisy jobsite and busy. Be brief, warm and direct, like a good site coordinator. One short question at a time. Never lecture.

${language} Tool arguments and summaries are always in English.

Tomorrow's booking for ${contact.company}:
- Work: ${activity.description}
- Area: ${activity.area}
- Start: ${formatClock(activity.start)} (${activity.start}), planned finish ${formatClock(activity.end)}
- Crew planned: ${activity.crewNeeded}
- Prerequisites to confirm:
${reqs}
- Materials needed to start: ${materials}

What to find out, in this order, skipping anything they already told you:
1. Are they coming, how many people, what time they arrive. Call confirm_attendance as soon as you have it.
2. Each prerequisite above: is it in place? Call confirm_requirement for each one.
3. Deliveries for the materials above: when do they land? Call log_delivery.
4. Anything that stops or slows them tomorrow. Call report_blocker for each.
5. Anything else for the superintendent. If they want a call back, call request_callback.
${questions}
Rules:
- Record facts only when the foreman has actually said them. Never assume a number, time or yes. If unclear, ask again in different words.
- Times go into tools as 24 hour HH:MM. "Seven" on a construction site means 07:00.
- If a tool returns an error, fix the argument by asking the foreman, do not tell them about the error.
- If they are driving or cannot talk, call request_callback and end politely.
- You cannot change the schedule or make promises. If asked, say you will pass it to ${project.superintendent}.
- When everything is covered, read back the key facts in one sentence, say goodbye, then call finish_check_in.
${instructions}`;
}

export function keyterms(project: Project, activity: Activity, contact: Contact, profile: AgentProfile = DEFAULT_PROFILE): string[] {
  const terms = [
    profile.name,
    contact.company,
    contact.foreman,
    project.superintendent,
    project.name,
    activity.area,
    ...activity.requirements.map((r) => r.label),
    ...activity.materials,
    ...project.vocabulary,
  ];
  const seen = new Set<string>();
  return terms
    .map((t) => t.trim())
    .filter((t) => t && !seen.has(t.toLowerCase()) && seen.add(t.toLowerCase()))
    .slice(0, MAX_KEYTERMS);
}
