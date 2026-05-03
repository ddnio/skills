# Kimi Integration — Architecture Reference

> Development reference for codex-buddy's Kimi adapter layer.
> For runtime usage, see [`references/kimi-cli.md`](../references/kimi-cli.md).

---

## Architecture Decision

**Current design: provider registry + shared probe flow.**

```
buddy-runtime.mjs:actionProbe(args)
  └─ providers.mjs:getProvider(args['buddy-model']).startTurn(...)
       ├─ codex provider
       │    ├─ broker path (default)
       │    ├─ app-server path (BUDDY_USE_APP_SERVER=1)
       │    └─ exec path (BUDDY_USE_LEGACY_EXEC=1 / fallback)
       └─ kimi provider
            ├─ kimi-wire-client.mjs:runKimiWireTurn() (default)
            │    ├─ JSON-RPC initialize / prompt / cancel
            │    ├─ event notifications → provider_event rows
            │    └─ client-side action requests rejected in review mode
            └─ kimi-adapter.mjs:execKimi() (legacy fallback only)
                 ├─ quiet final-message stdout
                 └─ parsers/kimi-repr-v1.mjs (compatibility)
```

**Why this shape?**
- `buddy-runtime.mjs` owns shared evidence loading, audit logging, synthesis envelope, and JSON output.
- `providers.mjs` owns provider capabilities and turn execution.
- Codex and Kimi both return the same normalized turn shape: final message, transport, provider events, session IDs, parser metadata, and degraded status.
- New CLI agents can be added as providers without branching the runtime.

Session JSONL is audit/replay history. It is not the realtime communication channel between agents.

---

## File Structure

```
scripts/
├── buddy-runtime.mjs          — shared actionProbe flow
├── lib/
│   ├── providers.mjs          — Codex/Kimi registry and startTurn contracts
│   ├── kimi-wire-client.mjs   — Kimi Wire JSON-RPC client
│   ├── kimi-adapter.mjs       — Kimi legacy exec + preflight
│   └── parsers/
│       └── kimi-repr-v1.mjs   — Best-effort legacy Kimi --print output parser
```

---

## Wire Contract

Kimi's primary transport is `kimi --wire`. The client sends a best-effort
`initialize`, then a `prompt` request with the evidence payload. Streaming
`event` notifications are normalized into `probe.provider_event` rows. If the
prompt times out, the client sends protocol `cancel` before killing the process.

Kimi review mode does not grant tools or approvals. Wire `request` messages for
tool calls, approvals, hooks, or questions are answered with safe rejection
payloads and recorded as `kimi/request_rejected`.

Wire timeout, empty final output, permission errors, and non-zero exits are
fail-closed. Startup/protocol-unsupported failures may fall back to legacy exec,
and that result is marked `degraded: true`.

---

## Verdict Contract

Kimi final text is normalized locally into:

| Verdict | `review_status` | Meaning |
|---------|-----------------|---------|
| `GO` | `passed` | No blocker was reported in a recognizable verdict line; top-level status is `verified`, process exit is 0 |
| `NO-GO` | `blocked` | A blocker was reported; top-level status is `blocked`, process exit is non-zero |
| `INCONCLUSIVE` | `inconclusive` | Output was unstructured or did not start with a supported verdict; top-level status is recoverable `error`, process exit is non-zero |

Unstructured text is preserved in the audit log but does not count as a clean
pass.

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

Models are now registered through `scripts/lib/providers.mjs`:
```js
const provider = getProvider(args['buddy-model'] || 'codex');
await provider.startTurn({ prompt, projectDir, buddySessionId });
```

Do NOT add a third model by copying provider-specific branches into `buddy-runtime.mjs`; implement the provider contract and register it.

---

## Known Limitations

1. **Kimi legacy output format is not a public contract** — runtime defaults to Wire; repr parsing is retained only as compatibility fallback.
2. **Session resume not implemented** — `kimi_session_id` is recorded in session log but `kimi -r <id>` resume is not wired into `actionFollowup`.
3. **No broker for Kimi** — Each probe spawns a fresh `kimi` process. No persistent thread across probes.

---

## Documentation Links

- Kimi CLI docs: https://moonshotai.github.io/kimi-cli/
- Kimi CLI GitHub: https://github.com/MoonshotAI/kimi-cli
- Agent Skills spec: https://agentskills.io/home
