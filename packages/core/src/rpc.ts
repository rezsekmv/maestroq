import { z } from "zod";
import { JobRecordSchema, JobSpecSchema, JobStatusSchema, PlatformSchema } from "./job-spec.js";

export const RpcRequestSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("ping") }),
  z.object({ op: z.literal("devices") }),
  z.object({ op: z.literal("submit"), spec: JobSpecSchema }),
  z.object({ op: z.literal("status"), jobId: z.string().optional() }),
  z.object({
    op: z.literal("logs"),
    jobId: z.string(),
    follow: z.boolean().default(false),
    tailLines: z.number().int().positive().optional(),
  }),
  z.object({ op: z.literal("cancel"), jobId: z.string() }),
  z.object({ op: z.literal("shutdown") }),
  z.object({
    op: z.literal("prune"),
    olderThanMs: z.number().int().nonnegative().optional(),
    statuses: z.array(JobStatusSchema).optional(),
    deleteLogs: z.boolean().optional(),
    deleteArtifacts: z.boolean().optional(),
  }),
]);
export type RpcRequest = z.infer<typeof RpcRequestSchema>;

export const RpcEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ok"), payload: z.unknown().optional() }),
  z.object({ kind: z.literal("error"), message: z.string() }),
  z.object({ kind: z.literal("log"), line: z.string() }),
  z.object({
    kind: z.literal("status"),
    jobId: z.string(),
    status: JobStatusSchema,
    exitCode: z.number().optional(),
    failureReason: z.string().optional(),
  }),
  z.object({ kind: z.literal("end") }),
]);
export type RpcEvent = z.infer<typeof RpcEventSchema>;

export const WorkerInfoSchema = z.object({
  udid: z.string(),
  platform: PlatformSchema,
  busy: z.boolean(),
  label: z.string().optional(),
});
export type WorkerInfo = z.infer<typeof WorkerInfoSchema>;

export const PingResponseSchema = z.object({ pong: z.literal(true) });
export type PingResponse = z.infer<typeof PingResponseSchema>;

export const SubmitResponseSchema = z.object({ jobId: z.string() });
export type SubmitResponse = z.infer<typeof SubmitResponseSchema>;

// JobRecord + runtime annotations the server attaches at response time.
// `deviceLabel` comes from the matching device entry in `~/.maestroq/config.yaml`
// (resolved via deviceUdid). Not persisted in queue.json since labels are a
// display detail of the current config, not part of the job's identity.
export const EnrichedJobRecordSchema = JobRecordSchema.extend({
  deviceLabel: z.string().optional(),
});
export type EnrichedJobRecord = z.infer<typeof EnrichedJobRecordSchema>;

export const StatusResponseSchema = z.object({
  jobs: z.union([EnrichedJobRecordSchema, z.array(EnrichedJobRecordSchema)]).optional(),
});
export type StatusResponse = z.infer<typeof StatusResponseSchema>;

export const CancelResponseSchema = z.object({ cancelled: z.string() });
export type CancelResponse = z.infer<typeof CancelResponseSchema>;

export const DevicesResponseSchema = z.object({ devices: z.array(WorkerInfoSchema) });
export type DevicesResponse = z.infer<typeof DevicesResponseSchema>;

export function encodeMessage(obj: unknown): string {
  return `${JSON.stringify(obj)}\n`;
}
