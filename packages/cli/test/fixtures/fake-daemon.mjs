#!/usr/bin/env node
import { writeFileSync } from "node:fs";
// Fake daemon for CLI tests. Usage: node fake-daemon.mjs <socketPath> <replyJSON> <captureFile>
import { createServer } from "node:net";

const [, , socketPath, replyJson, captureFile] = process.argv;
if (!socketPath || !replyJson || !captureFile) {
  console.error("usage: fake-daemon.mjs <socketPath> <replyJSON> <captureFile>");
  process.exit(2);
}
const reply = JSON.parse(replyJson);

const server = createServer((sock) => {
  let buf = "";
  sock.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      writeFileSync(captureFile, line);
      sock.write(`${JSON.stringify({ kind: "ok", payload: reply })}\n`);
      sock.write(`${JSON.stringify({ kind: "end" })}\n`);
    }
  });
});

server.listen(socketPath, () => {
  process.stdout.write("ready\n");
});

process.on("SIGTERM", () => {
  server.close();
  process.exit(0);
});
