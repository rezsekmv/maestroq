import type { JobStatus } from "@maestroq/core";

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
} as const;

export type ColorMode = "auto" | "always" | "never";

export function resolveUseColor(
  mode: ColorMode,
  stream: NodeJS.WriteStream = process.stdout,
): boolean {
  if (mode === "always") return true;
  if (mode === "never") return false;
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") return false;
  if (process.env.FORCE_COLOR === "0") return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0") return true;
  return Boolean(stream.isTTY);
}

const STATUS_COLOR: Record<JobStatus, keyof typeof ANSI> = {
  queued: "cyan",
  building: "yellow",
  installing: "yellow",
  "metro-starting": "yellow",
  running: "yellow",
  "tearing-down": "yellow",
  succeeded: "green",
  failed: "red",
  cancelled: "gray",
};

export function colorStatus(status: JobStatus): keyof typeof ANSI {
  return STATUS_COLOR[status];
}

export function colorExit(exitCode: number | undefined): keyof typeof ANSI | null {
  if (exitCode == null) return null;
  return exitCode === 0 ? "green" : "red";
}

export function paint(
  text: string,
  color: keyof typeof ANSI | null | undefined,
  opts: { bold?: boolean } = {},
): string {
  const codes: string[] = [];
  if (opts.bold) codes.push(ANSI.bold);
  if (color) codes.push(ANSI[color]);
  if (codes.length === 0) return text;
  return `${codes.join("")}${text}${ANSI.reset}`;
}
