/**
 * The tools the check-in agent may call, and what each one writes.
 *
 * A tool records a fact and the words it came from. It never decides what the
 * fact means for tomorrow; that is the findings engine's job. Arguments are
 * validated here rather than trusted, because they come from a model listening
 * to someone on a noisy site.
 */

import type {
  Activity,
  BlockerCategory,
  CheckIn,
  Evidence,
  RequirementStatus,
} from "../domain/types";
import { normalizeClock } from "../domain/time";
import type { ExtraQuestion } from "./profile";

export const BLOCKER_CATEGORIES: BlockerCategory[] = [
  "material",
  "access",
  "weather",
  "inspection",
  "equipment",
  "safety",
  "labor",
  "other",
];

const REQUIREMENT_STATUSES: RequirementStatus[] = ["confirmed", "not_confirmed", "unknown"];

export function toolDefinitions(activity: Activity, questions: ExtraQuestion[] = []) {
  const requirementIds = activity.requirements.map((r) => r.id);
  const tools: any[] = [
    {
      type: "function",
      name: "confirm_attendance",
      description:
        "Record whether the crew is coming tomorrow, how many people, and when they arrive. Call as soon as the foreman has said it, and again if they correct themselves.",
      parameters: {
        type: "object",
        properties: {
          coming: { type: "boolean", description: "True if the crew will be on site." },
          crew_size: { type: "integer", description: "Number of people, if stated." },
          arrival_time: { type: "string", description: "Arrival time as HH:MM in 24 hour form, if stated." },
        },
        required: ["coming"],
      },
    },
    {
      type: "function",
      name: "report_blocker",
      description: "Record anything that stops or slows the work tomorrow.",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", enum: BLOCKER_CATEGORIES },
          description: { type: "string", description: "One sentence in English, in the foreman's terms." },
        },
        required: ["category", "description"],
      },
    },
    {
      type: "function",
      name: "log_delivery",
      description: "Record a material delivery the foreman mentions for tomorrow.",
      parameters: {
        type: "object",
        properties: {
          material: { type: "string" },
          window_start: { type: "string", description: "HH:MM, 24 hour." },
          window_end: { type: "string", description: "HH:MM, 24 hour, if stated." },
        },
        required: ["material", "window_start"],
      },
    },
    {
      type: "function",
      name: "request_callback",
      description: "Record that the foreman wants the superintendent to call them.",
      parameters: {
        type: "object",
        properties: { reason: { type: "string" } },
        required: ["reason"],
      },
    },
    {
      type: "function",
      name: "finish_check_in",
      description: "Call once everything is covered and you have said goodbye.",
      parameters: {
        type: "object",
        properties: { summary: { type: "string", description: "One sentence, in English." } },
        required: ["summary"],
      },
    },
  ];

  if (questions.length > 0) {
    tools.splice(tools.length - 1, 0, {
      type: "function",
      name: "record_answer",
      description:
        "Record the foreman's answer to one of the superintendent's extra questions. For yes or no questions answer 'yes' or 'no'; for number questions a number; otherwise one short English sentence.",
      parameters: {
        type: "object",
        properties: {
          question_id: { type: "string", enum: questions.map((q) => q.id) },
          answer: { type: "string" },
        },
        required: ["question_id", "answer"],
      },
    });
  }

  if (requirementIds.length > 0) {
    tools.splice(2, 0, {
      type: "function",
      name: "confirm_requirement",
      description: "Record whether a prerequisite for tomorrow is in place.",
      parameters: {
        type: "object",
        properties: {
          requirement_id: { type: "string", enum: requirementIds },
          status: { type: "string", enum: REQUIREMENT_STATUSES },
          note: { type: "string" },
        },
        required: ["requirement_id", "status"],
      },
    });
  }

  return tools;
}

export interface ToolOutcome {
  checkIn: CheckIn;
  result: Record<string, unknown>;
  isError: boolean;
  finished: boolean;
}

/** Applies one tool call to a check-in, returning a new record. */
/** Phrases that mean "no blocker", which must never become a finding. */
const NOTHING = /^\s*(none|no|nothing|nil|n\/a|not applicable|no blockers?|none reported|nothing reported|nothing else|no issues?)[\s.!]*$/i;

export function applyTool(
  activity: Activity,
  checkIn: CheckIn,
  name: string,
  args: Record<string, unknown>,
  evidence: Evidence,
  questions: ExtraQuestion[] = [],
): ToolOutcome {
  const next: CheckIn = structuredClone(checkIn);
  next.updatedAt = evidence.at;
  if (next.status === "pending") next.status = "in_progress";

  const fail = (message: string): ToolOutcome => ({
    checkIn,
    result: { ok: false, error: message },
    isError: true,
    finished: false,
  });
  const ok = (result: Record<string, unknown> = {}, finished = false): ToolOutcome => ({
    checkIn: next,
    result: { ok: true, ...result },
    isError: false,
    finished,
  });

  switch (name) {
    case "confirm_attendance": {
      if (typeof args.coming !== "boolean") return fail("coming must be true or false");
      let crewSize: number | null = null;
      if (args.crew_size !== undefined && args.crew_size !== null) {
        const n = Number(args.crew_size);
        if (!Number.isInteger(n) || n < 0 || n > 500) return fail("crew_size must be a whole number");
        crewSize = n;
      }
      let arrival: string | null = null;
      if (args.arrival_time !== undefined && args.arrival_time !== null && args.arrival_time !== "") {
        arrival = normalizeClock(args.arrival_time);
        if (!arrival) return fail("arrival_time must be a time like 07:00; ask the foreman again");
      }
      const previous = next.attendance;
      next.attendance = {
        coming: args.coming,
        // A correction that only restates one field keeps the other.
        crewSize: crewSize ?? (args.coming ? previous?.crewSize ?? null : null),
        arrival: arrival ?? (args.coming ? previous?.arrival ?? null : null),
        evidence,
      };
      const missing = args.coming
        ? [next.attendance.crewSize === null && "crew size", next.attendance.arrival === null && "arrival time"].filter(Boolean)
        : [];
      return ok(missing.length ? { still_needed: missing } : {});
    }

    case "report_blocker": {
      const category = String(args.category ?? "") as BlockerCategory;
      if (!BLOCKER_CATEGORIES.includes(category)) return fail(`category must be one of ${BLOCKER_CATEGORIES.join(", ")}`);
      const description = text(args.description);
      if (!description) return fail("description is required");
      // "No, nothing else" is an answer, not a blocker. Recording absence as a
      // problem puts a finding on the morning board with a quote that reads as
      // though the foreman raised something, which is the opposite of what he
      // said. The agent is told to call this only when there is something real.
      if (NOTHING.test(description)) {
        return fail("Only report a blocker when the foreman names something real. Do not record that there is nothing.");
      }
      next.blockers.push({ category, description, evidence });
      return ok();
    }

    case "confirm_requirement": {
      const requirementId = String(args.requirement_id ?? "");
      if (!activity.requirements.some((r) => r.id === requirementId)) return fail("unknown requirement_id");
      const status = String(args.status ?? "") as RequirementStatus;
      if (!REQUIREMENT_STATUSES.includes(status)) return fail("status must be confirmed, not_confirmed or unknown");
      next.requirements.push({ requirementId, status, note: text(args.note), evidence });
      return ok();
    }

    case "log_delivery": {
      const material = text(args.material);
      if (!material) return fail("material is required");
      const windowStart = normalizeClock(args.window_start);
      if (!windowStart) return fail("window_start must be a time like 06:30");
      const windowEnd = args.window_end ? normalizeClock(args.window_end) : null;
      next.deliveries.push({ material, windowStart, windowEnd, evidence });
      return ok();
    }

    case "request_callback": {
      const reason = text(args.reason);
      if (!reason) return fail("reason is required");
      next.callback = { reason, evidence };
      return ok();
    }

    case "record_answer": {
      const question = questions.find((q) => q.id === args.question_id);
      if (!question) return fail("unknown question_id");
      const raw = text(args.answer);
      if (!raw) return fail("answer is required");

      let value = raw;
      if (question.answerType === "yes_no") {
        const yes = /^(yes|y|yeah|yep|si|sí|true|confirmed)\b/i.test(raw);
        const no = /^(no|n|nope|not|false)\b/i.test(raw);
        if (yes === no) return fail("this is a yes or no question; ask the foreman for a clear yes or no");
        value = yes ? "yes" : "no";
      } else if (question.answerType === "number") {
        const n = Number(raw.replace(/[^\d.-]/g, ""));
        if (!/\d/.test(raw) || !Number.isFinite(n)) return fail("this question needs a number; ask the foreman again");
        value = String(n);
      }

      next.answers = [
        ...(next.answers ?? []).filter((a) => a.questionId !== question.id),
        { questionId: question.id, question: question.text, value, evidence },
      ];
      return ok();
    }

    case "finish_check_in": {
      if (!next.attendance) return fail("attendance has not been confirmed yet; ask whether the crew is coming");
      next.summary = text(args.summary) || null;
      next.status = "complete";
      return ok({}, true);
    }

    default:
      return fail(`unknown tool ${name}`);
  }
}

export function emptyCheckIn(projectId: string, planDate: string, activity: Activity, now: string): CheckIn {
  return {
    projectId,
    planDate,
    activityId: activity.id,
    contactId: activity.contactId,
    status: "pending",
    attempts: 0,
    attendance: null,
    blockers: [],
    requirements: [],
    deliveries: [],
    callback: null,
    summary: null,
    callIds: [],
    updatedAt: now,
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 500) : "";
}
