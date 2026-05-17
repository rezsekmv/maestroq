import { z } from "zod";
import { PlatformSchema } from "./job-spec.js";

// Per-project config that lives at `.maestro/maestroq.yaml` alongside a project's
// existing Maestro flow files. The CLI walks up from the spec file (or cwd) to
// find it and merges its fields into the JobSpec before submitting. Spec fields
// always win — this is for defaults you don't want to repeat in every spec.
export const ProjectConfigSchema = z.object({
  cwd: z.string().optional(),
  defaults: z
    .object({
      platform: PlatformSchema.optional(),
      rebootSimBefore: z.boolean().optional(),
      build: z
        .union([
          z.object({
            variant: z.enum(["release", "debug"]).optional(),
            cache: z.boolean().optional(),
          }),
          z.literal("skip"),
        ])
        .optional(),
      metro: z
        .union([
          z.object({ reuse: z.boolean().optional() }),
          z.literal("skip"),
        ])
        .optional(),
      env: z.record(z.string(), z.string()).optional(),
      priority: z.number().int().optional(),
    })
    .optional(),
});
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
