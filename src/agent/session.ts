/**
 * One live check-in: a caller's audio on one side, a Voice Agent API session on
 * the other.
 *
 * The transport is whatever carries the foreman's audio, a Twilio media stream
 * or a browser socket, so phone and browser run the same conversation, the same
 * tools and the same record keeping.
 */

import * as crypto from "crypto";
import WebSocket from "ws";
import type { Activity, CheckIn, Contact, Evidence, Project } from "../domain/types";
import { buildSession, type AudioEncoding } from "./checkin";
import { applyTool } from "./tools";
import { getCheckIn, saveCall, saveCheckIn, type CallRecord } from "../store";
import { loadSettings } from "../settings";

const AAI_AGENT_URL = process.env.AAI_AGENT_URL || "wss://agents.assemblyai.com/v1/ws";

/** A check-in is a two minute conversation. These stop one becoming ten. */
const WRAP_UP_AFTER_MS = Number(process.env.MUSTER_WRAP_UP_MS || 150_000);
const HARD_STOP_DEFAULT_MS = Number(process.env.MUSTER_HARD_STOP_MS || 190_000);

export interface AudioTransport {
  sendAudio(base64: string): void;
  /** Drop audio queued for playback, because the foreman started talking. */
  clear(): void;
  /** Resolves once everything sent so far has been played to the foreman. */
  drain(): Promise<void>;
  close(): void;
}

interface PendingTool {
  callId: string;
  result: Record<string, unknown>;
  isError: boolean;
}

export class CheckInSession {
  readonly callId = `call_${crypto.randomBytes(8).toString("hex")}`;
  private aai: WebSocket | null = null;
  private ready = false;
  private ended = false;
  private checkIn: CheckIn;
  private record: CallRecord;
  private lastForemanText = "";
  private pendingTools: PendingTool[] = [];
  private finishRequested = false;
  private timers: NodeJS.Timeout[] = [];
  /** Read once, so a settings change mid-call cannot change the questions being asked. */
  private profile = loadSettings().agent;

  constructor(
    private project: Project,
    private activity: Activity,
    private contact: Contact,
    private transport: AudioTransport,
    private encoding: AudioEncoding,
    channel: CallRecord["channel"],
  ) {
    const now = new Date().toISOString();
    this.checkIn = getCheckIn(project, activity.id);
    this.checkIn.attempts += 1;
    this.checkIn.callIds.push(this.callId);
    if (this.checkIn.status === "pending" || this.checkIn.status === "unreachable") this.checkIn.status = "in_progress";
    this.checkIn.updatedAt = now;
    saveCheckIn(project, this.checkIn);

    this.record = {
      callId: this.callId,
      projectId: project.id,
      activityId: activity.id,
      planDate: project.planDate,
      company: contact.company,
      foreman: contact.foreman,
      work: `${activity.description}, ${activity.area}`,
      channel,
      startedAt: now,
      endedAt: null,
      endReason: null,
      turns: [],
      toolCalls: [],
    };
    saveCall(this.record);
  }

  /**
   * @param budgetSeconds talk time left on the plan this month. A call never runs
   *   past it: the agent is told to wrap up shortly before, and the line is closed at it.
   */
  start(budgetSeconds = Infinity) {
    const apiKey = process.env.ASSEMBLYAI_API_KEY;
    if (!apiKey) throw new Error("ASSEMBLYAI_API_KEY is not set");

    this.log("connecting to Voice Agent API");
    const aai = new WebSocket(AAI_AGENT_URL, { headers: { Authorization: `Bearer ${apiKey}` } });
    this.aai = aai;

    aai.on("open", () => {
      aai.send(
        JSON.stringify({
          type: "session.update",
          session: buildSession(this.project, this.activity, this.contact, this.encoding, this.profile),
        }),
      );
    });
    aai.on("message", (data) => this.onAgentEvent(data.toString()));
    aai.on("error", (e) => this.log(`agent socket error: ${e.message}`));
    aai.on("close", (code) => {
      this.log(`agent socket closed (${code})`);
      this.end(this.finishRequested ? "finished" : "agent_disconnected");
    });

    const budgetMs = budgetSeconds * 1000;
    // The longest call the superintendent allows, on the Phone settings page.
    const settingsMs = Math.max(30_000, loadSettings().phone.maxCallSeconds * 1000);
    const limitMs = Math.min(HARD_STOP_DEFAULT_MS, settingsMs);
    const hardStop = Math.min(limitMs, budgetMs);
    const wrapUp = Math.max(0, Math.min(WRAP_UP_AFTER_MS, hardStop - 40_000));
    this.timers.push(
      setTimeout(() => this.send({
        type: "conversation.message",
        role: "system",
        content: "Time is nearly up. Confirm anything still missing in one question, read back the key facts, say goodbye and call finish_check_in.",
      }), wrapUp),
      setTimeout(() => this.end(hardStop < limitMs ? "usage_limit" : "time_limit"), hardStop),
    );
  }

  /** Foreman audio, base64 in the session's encoding. */
  pushAudio(base64: string) {
    if (!this.ready || this.ended) return;
    this.send({ type: "input.audio", audio: base64 });
  }

  end(reason: string) {
    if (this.ended) return;
    this.ended = true;
    this.timers.forEach(clearTimeout);

    if (this.checkIn.status === "in_progress") {
      // Hung up before the wrap-up. What was said still counts.
      this.checkIn.status = this.checkIn.attendance ? "complete" : "pending";
      this.checkIn.updatedAt = new Date().toISOString();
      saveCheckIn(this.project, this.checkIn);
    }

    this.record.endedAt = new Date().toISOString();
    this.record.endReason = reason;
    saveCall(this.record);
    this.log(`ended: ${reason}`);

    if (this.aai && this.aai.readyState === WebSocket.OPEN) {
      this.send({ type: "session.end" });
      this.aai.close();
    }
    this.transport.close();
  }

  private onAgentEvent(raw: string) {
    let event: any;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }
    if (event.type === undefined && event.code) event.type = "session.error";

    switch (event.type) {
      case "session.ready":
        this.ready = true;
        this.log(`session ready ${event.session_id ?? ""}`);
        break;

      case "reply.audio":
        if (event.data) this.transport.sendAudio(event.data);
        break;

      case "input.speech.started":
        this.transport.clear();
        break;

      case "transcript.user.delta":
        if (event.text) this.lastForemanText = event.text;
        break;

      case "transcript.user":
        if (event.text) {
          this.lastForemanText = event.text;
          this.turn("foreman", event.text);
        }
        break;

      case "transcript.agent":
        if (event.text) this.turn("agent", event.text);
        break;

      case "tool.call":
        this.onToolCall(event);
        break;

      case "reply.done":
        if (event.status === "interrupted") {
          // The foreman cut in; the agent will ask again. Facts already written stay.
          this.pendingTools = [];
          break;
        }
        this.flushTools();
        break;

      case "session.error":
      case "error":
        this.log(`agent error ${event.code ?? ""} ${event.message ?? ""}`);
        break;
    }
  }

  private onToolCall(event: any) {
    const name: string = event.name ?? "";
    const args: Record<string, unknown> =
      event.arguments && typeof event.arguments === "object"
        ? event.arguments
        : typeof event.arguments === "string"
          ? safeParse(event.arguments)
          : event.args && typeof event.args === "object"
            ? event.args
            : {};

    const evidence: Evidence = {
      quote: this.lastForemanText,
      callId: this.callId,
      at: new Date().toISOString(),
    };
    const outcome = applyTool(this.activity, this.checkIn, name, args, evidence, this.profile.questions);
    if (!outcome.isError) {
      this.checkIn = outcome.checkIn;
      saveCheckIn(this.project, this.checkIn);
    }
    if (outcome.finished) this.finishRequested = true;

    this.record.toolCalls.push({ name, args, result: outcome.result, at: evidence.at });
    saveCall(this.record);
    this.log(`tool ${name} ${JSON.stringify(args)} -> ${JSON.stringify(outcome.result)}`);

    this.pendingTools.push({ callId: event.call_id, result: outcome.result, isError: outcome.isError });
  }

  private flushTools() {
    for (const t of this.pendingTools) {
      this.send({ type: "tool.result", call_id: t.callId, result: JSON.stringify(t.result), is_error: t.isError });
    }
    this.pendingTools = [];

    if (this.finishRequested) {
      // Let the goodbye finish playing before hanging up.
      this.transport
        .drain()
        .then(() => new Promise((r) => setTimeout(r, 400)))
        .then(() => this.end("finished"));
    }
  }

  private turn(role: "foreman" | "agent", text: string) {
    this.record.turns.push({ role, text, at: new Date().toISOString() });
    saveCall(this.record);
    this.log(`${role === "foreman" ? this.contact.foreman : "Muster"}: ${text}`);
  }

  private send(message: unknown) {
    if (this.aai && this.aai.readyState === WebSocket.OPEN) this.aai.send(JSON.stringify(message));
  }

  private log(message: string) {
    console.log(`[${this.callId} ${this.contact.company}] ${message}`);
  }
}

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}
