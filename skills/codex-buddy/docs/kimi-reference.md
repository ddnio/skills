# Kimi Integration — Architecture Reference

> Development reference for codex-buddy's Kimi adapter layer.
> For runtime usage, see [`references/kimi-cli.md`](../references/kimi-cli.md).

---

## Architecture Decision

**Chosen: Option A — Top-level routing fork** in `actionProbe`.

```
buddy-runtime.mjs:actionProbe(args)
  ├─ args['buddy-model'] === 'kimi'
  │    └─ kimi-adapter.mjs:execKimi()
  │         └─ parsers/kimi-repr-v1.mjs:parse()
  │              → { think[], text[], sessionId, parseStatus }
  │
  └─ default (codex)
       ├─ broker path (default)
       ├─ exec path (BUDDY_USE_LEGACY_EXEC=1)
       └─ app-server path (BUDDY_USE_APP_SERVER=1)
```

**Why Option A?**
- Codex three paths (exec/broker/app-server) are zero-touch — no regression risk
- Kimi is exec-only (no broker equivalent) — sharing the main flow would require awkward conditionals
- Clean separation: each model owns its full execution path

**Rejected: Option B** (shared probe main flow with internal switch)
- Codex's three-path runtime selection (useBroker/useAppServer/exec) doesn't map to Kimi's exec-only model
- Would introduce `if (model === 'kimi') skip this / use that` noise throughout
- Violates zero-regression principle

---

## File Structure

```
scripts/
├── buddy-runtime.mjs          — actionProbe: Kimi branch added at top
├── lib/
│   ├── kimi-adapter.mjs       — Kimi exec + preflight (no parsing)
│   └── parsers/
│       └── kimi-repr-v1.mjs   — Best-effort Kimi --print output parser
```

---

## Parser Contract (`parsers/kimi-repr-v1.mjs`)

```js
export const version = 'kimi-repr-v1';
export function match(raw)  → boolean   // detects Kimi --print format; never throws
export function parse(raw)  → {
  think: string[],           // ThinkPart content (reasoning)
  text: string[],            // TextPart content (final answer)
  sessionId: string|null,    // from "To resume this session: kimi -r <uuid>"
  parseStatus: 'ok'|'partial'|'failed'
}
```

**parseStatus semantics:**
- `ok` = both think and text extracted
- `partial` = text extracted, think missing (most common for short responses)
- `failed` = no text — synthesis falls back to raw stdout

Parser **never throws**. All error paths return `parseStatus:'failed'` with empty arrays.

---

## Audit Log Fields (M1-M3)

Three existing Codex `appendLog` calls now include `model: 'codex'`.
Kimi probe appends `model: 'kimi'`, `parse_status`, and `fallback`.

```js
// All appendLog rows now carry:
{
  model: 'codex' | 'kimi',       // M1: explicit, never defaulted
  parse_status: 'ok'|'partial'|'failed',  // M3: Kimi only
  fallback: 'none' | 'raw',      // M3: Kimi only
}
```

---

## Architecture Boundary (M5)

**This implementation supports exactly 2 buddy models: `codex` and `kimi`.**

Adding a third model requires refactoring to a registry pattern:
```js
// Future: scripts/lib/model-registry.mjs
const ADAPTERS = {
  codex: codexAdapter,
  kimi: kimiAdapter,
  // deepseek: deepseekAdapter,
};
```

Do NOT add a third model by copying the Kimi `if` branch — that leads to unmaintainable duplication. Refactor first.

---

## Known Limitations

1. **Kimi output format is not a public contract** — `ThinkPart`/`TextPart` repr format may change in future Kimi versions. If parsing degrades, check for a `--json` flag in newer Kimi CLI versions.
2. **Session resume not implemented** — `kimi_session_id` is recorded in session log but `kimi -r <id>` resume is not wired into `actionFollowup`.
3. **No broker for Kimi** — Each probe spawns a fresh `kimi` process. No persistent thread across probes.
4. **`--afk` flag semantics** — Kimi's afk mode auto-approves all tool calls. Ensure probes only pass evidence, not instructions.

---

## Documentation Links

- Kimi CLI docs: https://moonshotai.github.io/kimi-cli/
- Kimi CLI GitHub: https://github.com/MoonshotAI/kimi-cli
- Agent Skills spec: https://agentskills.io/home
