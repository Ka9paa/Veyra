import { z } from "zod";

export const AgentRoleSchema = z.enum(["designer", "responsive", "qa"]);
export type AgentRole = z.infer<typeof AgentRoleSchema>;

export const ProjectFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
});
export type ProjectFile = z.infer<typeof ProjectFileSchema>;

export const ProjectSnapshotSchema = z.object({
  files: z.array(ProjectFileSchema),
});
export type ProjectSnapshot = z.infer<typeof ProjectSnapshotSchema>;

export const PatchOperationSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("create"),
    path: z.string().min(1),
    content: z.string(),
  }),
  z.object({
    type: z.literal("replace"),
    path: z.string().min(1),
    content: z.string(),
  }),
  z.object({
    type: z.literal("delete"),
    path: z.string().min(1),
  }),
]);
export type PatchOperation = z.infer<typeof PatchOperationSchema>;

export const PatchSetSchema = z.object({
  summary: z.string().default(""),
  operations: z.array(PatchOperationSchema),
});
export type PatchSet = z.infer<typeof PatchSetSchema>;

export const QASeveritySchema = z.enum(["info", "warning", "error", "critical"]);
export type QASeverity = z.infer<typeof QASeveritySchema>;

export const QAIssueSchema = z.object({
  severity: QASeveritySchema,
  file: z.string().optional(),
  message: z.string().min(1),
  suggestion: z.string().optional(),
});
export type QAIssue = z.infer<typeof QAIssueSchema>;

export const AgentResultSchema = z.object({
  role: AgentRoleSchema,
  reasoningSummary: z.string().default(""),
  patch: PatchSetSchema,
  issues: z.array(QAIssueSchema).default([]),
});
export type AgentResult = z.infer<typeof AgentResultSchema>;

export const AgentRunRequestSchema = z.object({
  prompt: z.string().min(1),
  project: ProjectSnapshotSchema,
  maxHealingPasses: z.number().int().min(0).max(5).default(2),
  framework: z.enum(["react", "nextjs"]).default("nextjs"),
});
export type AgentRunRequest = z.infer<typeof AgentRunRequestSchema>;

export const CoordinatorEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("agent:start"), role: AgentRoleSchema }),
  z.object({
    type: z.literal("agent:complete"),
    role: AgentRoleSchema,
    result: AgentResultSchema,
  }),
  z.object({
    type: z.literal("patch:applied"),
    role: AgentRoleSchema,
    summary: z.string(),
    project: ProjectSnapshotSchema,
  }),
  z.object({
    type: z.literal("qa:issues"),
    pass: z.number().int().min(0),
    issues: z.array(QAIssueSchema),
  }),
  z.object({
    type: z.literal("complete"),
    project: ProjectSnapshotSchema,
  }),
  z.object({
    type: z.literal("error"),
    message: z.string(),
  }),
]);
export type CoordinatorEvent = z.infer<typeof CoordinatorEventSchema>;
