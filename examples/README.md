# examples

Ready-to-adapt `maestroq` job specs. Drop a `.maestro/` directory (or files into your existing one) at the root of your project alongside your Maestro flow files, tweak the flow paths and env vars, and you're done.

## `plain-rn/`

A minimal smoke spec for a vanilla React Native / Expo project — single flow, release build, no extra env. Use this as the starting template if you're wiring `maestroq` into a new project for the first time.

The directory layout is the convention every project should follow:

```
plain-rn/
└── .maestro/
    ├── maestroq.yaml     # optional per-project defaults (cwd, rebootSimBefore, build…)
    └── smoke-ios.yaml    # one job spec per scenario
```

`maestroq.yaml` is optional — when present, the CLI walks up from the spec file to find it and merges its `defaults:` block into the spec before submission. Spec fields always win.

## Auto-scaffolded vs. these examples

`maestroq init` writes a starter spec automatically when `.maestro/` exists in your project — it's the path of least resistance. Reach for these examples when you want to see more options (`metro.reuse`, `rebootSimBefore`, `priority`, `build` variants) wired together.

For larger-shape specs (regression / full-suite) see [`integrations/claude-code/SKILL.md`](../integrations/claude-code/SKILL.md) — the regression-spec section is the same pattern whether you're an agent or a human.
