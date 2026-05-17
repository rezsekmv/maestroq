# examples

Ready-to-adapt `maestroq` job specs. Copy a directory into your own repo as `maestroq/`, tweak the flow paths and env vars, and you're done.

## `plain-rn/`

A minimal smoke spec for a vanilla React Native / Expo project — single flow, release build, no extra env. Use this as the starting template if you're wiring `maestroq` into a new project for the first time.

## Auto-scaffolded vs. these examples

`maestroq init` writes a starter spec automatically when `.maestro/` exists in your project — it's the path of least resistance. Reach for these examples when you want to see more options (`metro.reuse`, `rebootSimBefore`, `priority`, `build` variants) wired together.

For larger-shape specs (regression / full-suite) see [`integrations/claude-code/SKILL.md`](../integrations/claude-code/SKILL.md) — the regression-spec section is the same pattern whether you're an agent or a human.
