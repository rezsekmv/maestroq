import type { JobRecord, RpcEvent } from "@maestroq/core";

export function printDevices(payload: unknown): void {
  const devices = (payload as { devices: Array<{ udid: string; platform: string; busy: boolean }> }).devices;
  if (!devices.length) {
    process.stdout.write("(no devices configured — edit ~/.maestroq/config.yaml)\n");
    return;
  }
  for (const d of devices) {
    process.stdout.write(`${d.platform.padEnd(8)} ${d.udid.padEnd(40)} ${d.busy ? "busy" : "idle"}\n`);
  }
}

export function printJobs(payload: unknown): void {
  const jobs = (payload as { jobs: JobRecord | JobRecord[] | undefined }).jobs;
  const list = Array.isArray(jobs) ? jobs : jobs ? [jobs] : [];
  if (!list.length) {
    process.stdout.write("(no jobs)\n");
    return;
  }
  for (const j of list) {
    const label = j.spec.label ?? j.spec.flows[0] ?? "";
    process.stdout.write(
      `${j.id.slice(0, 8)}  ${j.spec.platform.padEnd(7)} ${j.status.padEnd(15)} ${label}\n`,
    );
  }
}

export function printEvent(ev: RpcEvent): void {
  switch (ev.kind) {
    case "log":
      process.stdout.write(`${ev.line}\n`);
      return;
    case "status":
      process.stderr.write(`[status] ${ev.jobId}: ${ev.status}${ev.exitCode != null ? ` (exit ${ev.exitCode})` : ""}\n`);
      return;
    case "error":
      process.stderr.write(`[error] ${ev.message}\n`);
      return;
    default:
      return;
  }
}
