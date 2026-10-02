import { z } from "zod";
import { isDate, isTime } from "../academics";

const id = z.string().min(1).max(120);
const date = z.string().refine(isDate, "Use a valid YYYY-MM-DD date.");
const time = z.string().refine(isTime, "Use a valid HH:mm time.");
const title = z.string().trim().min(1).max(500);
const courseId = z.string().max(120);
const description = z.string().max(20000);
const duration = z.number().int().min(1).max(1440);
const assignmentFields = { title, courseId, dateKey: date, dueTime: time.optional(), description: description.optional(), type: z.enum(["Assignment", "Exam", "Project"]).optional() };
export const operationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("create_assignment"), ...assignmentFields }).strict(),
  z.object({ kind: z.literal("update_assignment"), id, title: title.optional(), courseId: courseId.optional(), dateKey: date.optional(), dueTime: z.union([time, z.literal("")]).optional(), description: description.optional() }).strict(),
  z.object({ kind: z.literal("mark_assignment_complete"), id }).strict(),
  z.object({ kind: z.literal("create_calendar_event"), title, courseId, dateKey: date, time, durationMinutes: duration, type: z.enum(["Study block", "Exam", "Office hours", "Appointment", "Personal"]), description: description.optional() }).strict(),
  z.object({ kind: z.literal("move_calendar_event"), id, dateKey: date, time, durationMinutes: duration }).strict(),
]);
export type Operation = z.infer<typeof operationSchema>;
export type Citation = { id: string; label: string; text: string; kind: "record" | "document"; sourceId?: string; version?: string; page?: number; recordId?: string };
export type Answer = { blocks: { kind: "fact" | "recommendation" | "general" | "unknown"; text: string; citations: string[] }[] };
export const answerSchema = z.object({ blocks: z.array(z.object({ kind: z.enum(["fact", "recommendation", "general", "unknown"]), text: z.string().min(1).max(4000), citations: z.array(z.string().max(160)).max(12) }).strict()).min(1).max(12) }).strict();
export const messageSchema = z.object({ conversationId: z.string().uuid(), requestId: z.string().uuid(), message: z.string().trim().min(1).max(8000) }).strict();
export const proposalRequestSchema = z.object({ id: z.string().uuid(), action: z.enum(["apply", "dismiss"]) }).strict();
export const AI_PROMPT_VERSION = "academic-v2";
export const AI_MAX_INPUT_CHARS = 60000;
export const AI_MAX_OUTPUT_TOKENS = 4096;
export const AI_MAX_CALLS = 4;
export const AI_MAX_PROVIDER_ATTEMPTS = 6;
export const AI_MAX_TOOLS = 12;

export class AnswerValidationError extends Error {
  constructor(public code: "invalid_format" | "uncited_fact" | "unknown_citation", message: string) { super(message); }
}
export function validateAnswer(value: unknown, evidence: Map<string, Citation>): Answer {
  const parsed = answerSchema.safeParse(value);
  if (!parsed.success) throw new AnswerValidationError("invalid_format", "The model returned an invalid answer format.");
  const answer = parsed.data;
  for (const block of answer.blocks) {
    if (block.kind === "fact" && !block.citations.length) throw new AnswerValidationError("uncited_fact", "An academic fact had no evidence.");
    for (const citation of block.citations) if (!evidence.has(citation)) throw new AnswerValidationError("unknown_citation", "An answer cited unavailable evidence.");
  }
  return answer;
}
