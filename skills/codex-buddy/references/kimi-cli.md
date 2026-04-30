# Kimi CLI Reference

> Runtime reference for codex-buddy's Kimi integration (`--buddy-model kimi`).
> See also: [Kimi CLI official docs](https://moonshotai.github.io/kimi-cli/) · [GitHub](https://github.com/MoonshotAI/kimi-cli)

---

## Quick Start

```bash
# Run Kimi probe (instead of default Codex)
echo "$EVIDENCE" | node "<SKILL_DIR>/scripts/buddy-runtime.mjs" \
  --action probe --buddy-model kimi --evidence-stdin --project-dir "$PWD"

# Preflight check (verify Kimi is available)
node "<SKILL_DIR>/scripts/buddy-runtime.mjs" --action preflight --buddy-model kimi

# Default Codex preflight (unchanged)
node "<SKILL_DIR>/scripts/buddy-runtime.mjs" --action preflight
```

### 多行证据传递（heredoc 注意事项）

当证据包含多行内容或需要 shell 变量展开时，使用**不加引号**的 heredoc 分隔符：

```bash
# ✅ 正确：不加引号的 EOF，$() 和变量会展开
EVIDENCE_FILE=$(mktemp)
cat > "$EVIDENCE_FILE" << EOF
task_to_judge: $(your_task_description)
$(cat /path/to/diff.txt)
known_omissions: none
EOF
cat "$EVIDENCE_FILE" | node "<SKILL_DIR>/scripts/buddy-runtime.mjs" \
  --action probe --buddy-model kimi --evidence-stdin --project-dir "$PWD"

# ❌ 错误：加引号的 'EOF'，$() 不展开，Kimi 收到字面量路径然后试图执行 shell 命令
cat > "$EVIDENCE_FILE" << 'EOF'
$(cat /path/to/diff.txt)   # ← Kimi 看到的是这个字面量，不是内容
EOF
```

---

## How Kimi Is Invoked

buddy-runtime spawns:
```
kimi --print --afk -p "<evidence+prompt>"
```

| Flag | Purpose |
|------|---------|
| `--print` | Non-interactive print mode (auto-dismiss AskUserQuestion, auto-approve tools) |
| `--afk`   | Away-from-keyboard: no user present, fully autonomous turn |
| `-p`      | Prompt text (evidence + task) |

**`--afk` note**: This flag means Kimi may automatically apply tool calls without confirmation. Ensure evidence prompts do not contain instructions that could trigger unintended file modifications. codex-buddy passes evidence as read-only context framing, not as executable instructions.

---

## Output Format (Kimi --print v1.40.0)

Kimi `--print` emits a Python-repr-style event stream to stdout:

```
TurnBegin(user_input='...')
StepBegin(n=1)
ThinkPart(
    type='think',
    think='<reasoning content>',
    encrypted=None
)
TextPart(type='text', text='<final answer>')
StatusUpdate(context_usage=..., token_usage=TokenUsage(...), message_id='...', ...)
TurnEnd()

To resume this session: kimi -r <uuid>
```

**buddy-runtime handling:**
- `ThinkPart.think` → written to `~/.buddy/sessions/<sid>.jsonl` as `probe.kimi_think` event (audit, not shown in synthesis)
- `TextPart.text` → used as synthesis content (equivalent to Codex final message)
- Session ID → extracted from resume line, stored in session log

---

## Parser Status

The parser (`parsers/kimi-repr-v1.mjs`) uses best-effort regex matching:

| `parseStatus` | Meaning | Synthesis source |
|--------------|---------|-----------------|
| `ok` | Both think and text extracted | `TextPart.text` |
| `partial` | Text extracted, think missing | `TextPart.text` |
| `failed` | No text extracted | raw stdout (fallback) |

`fallback: 'none'` when parseStatus is ok/partial; `fallback: 'raw'` when failed.
Both `parse_status` and `fallback` are written to the audit log row.

---

## Session Resume

Kimi supports session resumption but **resume is not implemented in this version**:
- The session ID is parsed from `To resume this session: kimi -r <uuid>`
- It is stored in `~/.buddy/sessions/<sid>.jsonl` as `kimi_session_id`
- `kimi -r <uuid>` for manual resume if needed

---

## Environment Variables

| Variable | Effect |
|---------|--------|
| `BUDDY_USE_LEGACY_EXEC=1` | Force Codex exec path (does NOT affect Kimi routing) |
| `BUDDY_USE_BROKER=0` | Same as above |
| (no Kimi-specific env var) | Use `--buddy-model kimi` arg to activate |

---

## Useful Links

- **Kimi CLI official docs**: https://moonshotai.github.io/kimi-cli/
- **LLM-friendly docs**: https://moonshotai.github.io/kimi-cli/llms.txt
- **GitHub**: https://github.com/MoonshotAI/kimi-cli
- **Agent Skills spec** (context for cross-agent skills): https://agentskills.io/home
