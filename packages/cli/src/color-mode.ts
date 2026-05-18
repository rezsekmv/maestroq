import type { ColorMode } from "./color.js";

// Translate a CLI flag value (a string from --color, possibly absent or
// passed as a bare boolean by citty) into a ColorMode that color.ts understands.
export function colorMode(raw: string | boolean | undefined): ColorMode {
  if (raw === undefined || raw === "" || raw === true) return "auto";
  if (raw === false) return "never";
  const s = String(raw).toLowerCase();
  if (s === "always" || s === "yes" || s === "true" || s === "on") return "always";
  if (s === "never" || s === "no" || s === "false" || s === "off") return "never";
  return "auto";
}
