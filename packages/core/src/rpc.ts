import { z } from "zod";
import { JobSpecSchema, JobStatusSchema } from "./job-spec.js";

export const RpcRequestSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("ping") }),
  z.object({ op: z.literal("devices") }),
  z.object({ op: z.literal("submit"), spec: JobSpecSchema }),
  z.object({ op: z.literal("status"), jobId: z.string().optional() }),
  z.object({ op: z.literal("logs"), jobId: z.string(), follow: z.boolean().default(false) }),
  z.object({ op: z.literal("cancel"), jobId: z.string() }),
  z.object({ op: z.literal("shutdown") }),
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

export function encodeMessage(obj: unknown): string {
  return `${JSON.stringify(obj)}\n`;
}
