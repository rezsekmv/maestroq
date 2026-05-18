import { readFileSync } from "node:fs";

export const VERSION: string = (() => {
  const pkgUrl = new URL("../package.json", import.meta.url);
  const raw = readFileSync(pkgUrl, "utf8");
  return (JSON.parse(raw) as { version: string }).version;
})();
