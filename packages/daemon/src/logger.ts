import pino from "pino";

export const logger = pino({
  level: process.env.MAESTROQ_LOG_LEVEL ?? "info",
  transport:
    process.stdout.isTTY && process.env.MAESTROQ_LOG_PRETTY !== "0"
      ? { target: "pino/file", options: { destination: 1 } }
      : undefined,
});
