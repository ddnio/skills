# SESSION HANDOFF

> Auto-injected into the next Claude session by `hooks/session-start`. Cap 8KB.
> Update this file at the END of a working session so the NEXT session knows where to pick up.

---

## Where we are

- **Branch:** `feat/ux-stage1` (worktree: `.worktrees/feat/ux-stage1`)
- **Latest commit:** stage5e — per-worktree buddy_session_id isolation + handoff injection
- **Status:** 13 commits ahead of main; **NOT merged** (red line: needs L3 real-use validation + user sign-off).

## Done in last session

- **Stage 5b (f28d261)** Audit/decision schema v2: rename fields, add `verification_task_id` join key, remove `annotateLastEntry` (broke append-only).
- **Stage 5c (716995d)** Post-review fixes: C1 annotate field accumulation regression, C2 canonical field shadowing, C3 schema staleness, C4+C5 docs.
- **Stage 5d (8951702)** Strict v2 contract: schema split (envelope vs audit-row-v2), `appendLog` options-object signature, expanded validator with negative tests, F6 default annotate→probe-only, F5 shared `lib/annotations.mjs`.
- **Stage 5e** Per-worktree buddy_session_id (eliminates global mutable pointer race) + SESSION_HANDOFF.md auto-injection.

## Verification status

- 86→94→? unit tests (run `node --test scripts/__tests__/*.test.mjs scripts/lib/__tests__/*.test.mjs`)
- `bash scripts/verify-repo.sh` last result: PASSED
- L3 (real Claude session running probes against new SKILL.md): **not yet done**

## Next session: where to pick up

### Highest priority — L3 behavioral verification (red line gate)

1. Restart Claude session in `feat/ux-stage1` worktree
2. Trigger a real probe with codex-buddy, confirm:
   - `~/.buddy/state/by-cwd/<hash>.json` is written (NOT just legacy `buddy-session.json`)
   - `~/.buddy/logs.jsonl` new entry has v2 schema (`schema_version: 2`, `ts`, `buddy_session_id`, `verification_task_id`)
   - annotate handler defaults to probe-only (verify by triggering followup → annotate(no id) → metrics counts the probe)
3. If all pass → tell user "L3 OK, ready for merge gate"

### Medium — bench broker startup data

`node scripts/buddy-bench.mjs --mode broker-startup-delta` to validate W11 broker default. Need ≥10 broker probes to compute delta. Currently insufficient samples.

### Lower — additional ideas surfaced this session

- Default annotate has UX edge: error message on "no probe found" could be friendlier
- `buddy-session.json` legacy file should eventually be deleted (after a few weeks of v2 usage)
- README / SKILL.md still reference `~/.buddy/logs.jsonl` — could be renamed to `decisions.jsonl` for clarity (low value, deferred)

## Red lines (do not cross without explicit user OK)

1. **No merge to main** until L3 validation + user sign-off.
2. **No deletion of legacy data** in `~/.buddy/` (421 KB of historical logs.jsonl exists).
3. **No `--no-verify` / hook-skip** in commits.

## Convention reminders

- All session work in worktree `.worktrees/feat/ux-stage1`, not in main.
- Commit messages use `feat(stageNX): ...` or `fix(stageNX): ...`.
- After each stage: update CHANGELOG, run verify-repo, sync to `~/.claude/skills/codex-buddy/` via `scripts/sync-skill.sh`.
