import { z } from "zod";

export const PlatformSchema = z.enum(["ios", "android"]);
export type Platform = z.infer<typeof PlatformSchema>;

export const VariantSchema = z.enum(["release", "debug"]);
export type Variant = z.infer<typeof VariantSchema>;

export const BuildSpecSchema = z.object({
  variant: VariantSchema.default("release"),
  cache: z.boolean().default(true),
});
export type BuildSpec = z.infer<typeof BuildSpecSchema>;

export const MetroSpecSchema = z.object({
  reuse: z.boolean().default(true),
});
export type MetroSpec = z.infer<typeof MetroSpecSchema>;

export const JobSpecSchema = z.object({
  cwd: z.string().min(1),
  flows: z.array(z.string().min(1)).min(1),
  platform: PlatformSchema,
  build: z.union([BuildSpecSchema, z.literal("skip")]).default({ variant: "release", cache: true }),
  metro: z.union([MetroSpecSchema, z.literal("skip")]).default("skip"),
  env: z.record(z.string(), z.string()).default({}),
  priority: z.number().int().default(0),
  rebootSimBefore: z.boolean().default(false),
  label: z.string().optional(),
});
export type JobSpec = z.infer<typeof JobSpecSchema>;
export type JobSpecInput = z.input<typeof JobSpecSchema>;

export const JobStatusSchema = z.enum([
  "queued",
  "building",
  "installing",
  "metro-starting",
  "running",
  "tearing-down",
  "succeeded",
  "failed",
  "cancelled",
]);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const TerminalStatuses: ReadonlySet<JobStatus> = new Set([
  "succeeded",
  "failed",
  "cancelled",
]);

export const ActiveStatuses: ReadonlySet<JobStatus> = new Set([
  "building",
  "installing",
  "metro-starting",
  "running",
  "tearing-down",
]);

export const JobRecordSchema = z.object({
  id: z.string(),
  spec: JobSpecSchema,
  status: JobStatusSchema,
  createdAt: z.number(),
  startedAt: z.number().optional(),
  finishedAt: z.number().optional(),
  deviceUdid: z.string().optional(),
  pgid: z.number().optional(),
  failureReason: z.string().optional(),
  exitCode: z.number().optional(),
  logPath: z.string().optional(),
});
export type JobRecord = z.infer<typeof JobRecordSchema>;
