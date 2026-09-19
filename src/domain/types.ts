/**
 * The shapes Muster reasons about.
 *
 * A project has a plan for one working day: activities, each booked with a
 * subcontractor whose foreman is called the evening before. What the foreman
 * says becomes a CheckIn, a record of facts, each carrying the words it came from.
 * Findings are computed from plan and check-ins by pure functions, never by the model.
 */

export type Language = "en" | "es";

export interface Contact {
  id: string;
  company: string;
  trade: string;
  foreman: string;
  phone: string;
  language: Language;
}

/** Something that must be in place before an activity can start. */
export interface Requirement {
  id: string;
  label: string;
}

export interface Activity {
  id: string;
  contactId: string;
  description: string;
  area: string;
  /** Planned start, "HH:MM" local to the project. */
  start: string;
  /** Planned finish, "HH:MM". */
  end: string;
  crewNeeded: number;
  /** When true, no other trade may work the same area at the same time. */
  exclusiveArea: boolean;
  requirements: Requirement[];
  /** Material the activity cannot start without. */
  materials: string[];
}

export interface Project {
  id: string;
  name: string;
  superintendent: string;
  timezone: string;
  planDate: string;
  vocabulary: string[];
  contacts: Contact[];
  activities: Activity[];
}

/** The words a fact came from, so no finding exists without a source. */
export interface Evidence {
  quote: string;
  callId: string;
  at: string;
}

export interface Attendance {
  coming: boolean;
  crewSize: number | null;
  arrival: string | null;
  evidence: Evidence;
}

export type BlockerCategory =
  | "material"
  | "access"
  | "weather"
  | "inspection"
  | "equipment"
  | "safety"
  | "labor"
  | "other";

export interface Blocker {
  category: BlockerCategory;
  description: string;
  evidence: Evidence;
}

export type RequirementStatus = "confirmed" | "not_confirmed" | "unknown";

export interface RequirementCheck {
  requirementId: string;
  status: RequirementStatus;
  note: string;
  evidence: Evidence;
}

export interface Delivery {
  material: string;
  windowStart: string;
  windowEnd: string | null;
  evidence: Evidence;
}

export interface Answer {
  questionId: string;
  /** The question as it was worded when asked. */
  question: string;
  value: string;
  evidence: Evidence;
}

export type CheckInStatus = "pending" | "in_progress" | "complete" | "unreachable";

export interface CheckIn {
  projectId: string;
  planDate: string;
  activityId: string;
  contactId: string;
  status: CheckInStatus;
  attempts: number;
  attendance: Attendance | null;
  blockers: Blocker[];
  requirements: RequirementCheck[];
  deliveries: Delivery[];
  callback: { reason: string; evidence: Evidence } | null;
  /** Answers to the customer's extra questions, latest per question. */
  answers?: Answer[];
  summary: string | null;
  callIds: string[];
  updatedAt: string;
}

export type Severity = "critical" | "high" | "medium" | "low";

export type FindingCode =
  | "NO_CHECK_IN"
  | "UNREACHABLE"
  | "NOT_COMING"
  | "CREW_SHORT"
  | "LATE_ARRIVAL"
  | "REQUIREMENT_UNCONFIRMED"
  | "DELIVERY_AFTER_START"
  | "BLOCKER"
  | "AREA_CLASH"
  | "CALLBACK_REQUESTED";

export interface Finding {
  code: FindingCode;
  severity: Severity;
  activityIds: string[];
  title: string;
  detail: string;
  evidence: Evidence[];
}
