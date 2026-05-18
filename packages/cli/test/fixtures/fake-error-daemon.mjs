#!/usr/bin/env node
// Fake daemon for CLI tests that always replies with kind:"error" then "end".
// Usage: node fake-error-daemon.mjs <socketPath> <message>
import { createServer } from "node:net";

const [, , socketPath, message] = process.argv;
if (!socketPath || !message) {
  console.error("usage: fake-error-daemon.mjs <socketPath> <message>");
  process.exit(2);
}

const server = createServer((sock) => {
  let buf = "";
  sock.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.trim()) continue;
      sock.write(`${JSON.stringify({ kind: "error", message })}\n`);
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
