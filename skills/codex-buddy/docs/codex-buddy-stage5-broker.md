# codex-buddy Stage 5: lazy broker + 持久 thread

> 替换 plan v2 中的 W4b 条件触发设计。Buddy ≠ 工具：使用模式不同，默认行为不同。
> 决策依据：用户论点 + 官方 codex-plugin-cc 源码（`/tmp/codex-plugin-cc/plugins/codex/scripts/app-server-broker.mjs`）。

---

## 核心设计

```
首次 probe（lazy spawn）:
  ├─ 检查 broker.sock 是否活：活 → 直接 turn/start
  ├─ 不活：spawn `codex app-server`（后台进程）
  ├─ thread/start → 拿 threadId
  ├─ 写入 ~/.buddy/conv-<buddy-sid>.json
  └─ turn/start with new threadId

后续 probe（默认）:
  └─ load conv-<sid>.json → turn/start with saved threadId（codex 看得到历史）

probe --fresh-thread:
  └─ thread/start 新 thread，不写入 conv 文件，本次独立

SessionEnd（hook）/ 用户主动 cancel:
  └─ sendBrokerShutdown → broker 优雅退出 → thread 持久化在 ~/.codex/sessions/，可 codex resume 复盘
```

## 工作项

### W6.5 — Anti-contamination tripwire（新增，Architect synthesis）
- [ ] `lib/topic-drift.mjs`：cheap Jaccard on 上次 turn 的 task_to_judge keywords vs 本次
- [ ] 阈值低于 0.15 → stderr 写 `[buddy] topic-drift detected (Jaccard=0.08), consider --fresh-thread` —— **soft warning，不 auto-fork**
- [ ] 不 stderr → 直接 turn/start 持久 thread（默认行为不变）
- [ ] 单测：高相似度 task → 不警告；低相似度 → 警告字符串出现

### W7 — broker 启停管理（lazy spawn + lifecycle）
- [ ] `scripts/lib/buddy-broker.mjs`：spawn / connect / shutdown / detect-alive
  - 端点：`${BUDDY_HOME}/broker-<worktree-hash>.sock`（多 worktree 隔离）
  - PID 文件：`${BUDDY_HOME}/broker-<worktree-hash>.pid`
  - lock：connect 失败 + PID 进程不在 → 视为 stale，重启
- [ ] `scripts/buddy-broker-cli.mjs`：手动 `start|stop|status` 调试用
- [ ] `hooks/session-end`（新）：调 sendBrokerShutdown
- [ ] 单测：spawn → connect → shutdown 往返；stale lock 恢复

### W8 — thread 持久化 + lazy 接入 actionProbe
- [ ] `scripts/buddy-runtime.mjs:actionProbe`：
  - 默认路径变成 broker（不再看 `BUDDY_USE_APP_SERVER` env）
  - load `~/.buddy/conv-<buddy-sid>.json` 读 threadId
  - 不存在 → broker.threadStart() → 写 conv 文件 → turn/start
  - 存在 → 直接 turn/start
  - `--fresh-thread`：跳过 conv 文件读写，临时 thread
- [ ] `scripts/lib/codex-app-server.mjs`：增加 broker 模式调用（vs 现有 spawn-per-call）
- [ ] **保留 fallback**：env `BUDDY_USE_LEGACY_EXEC=1` 走旧 codex exec 路径（万一 broker 出 bug 用户能跳过）
- [ ] 单测：mock broker socket，验证 thread 复用 + fresh-thread 隔离

### W9 — 修 W4a first_byte_ms 的伪指标 bug + 重新基准
- [ ] `execCodex` / broker turn 监听 **stderr** 首字节（不是 stdout）
- [ ] 加 broker.turnStart() 同样字段
- [ ] 重跑 ≥10 次真实 probe，bench 看：
  - exec 模式 startup_pct
  - broker 模式 startup_pct
  - **broker 是否真的省了** 5-10s（用 wall clock 对比首次 probe vs 第二次 probe）

### W10 — Stage 4 cleanup（Codex review 8 findings 的小项）
- [ ] 移除误提交 `skills/codex-buddy/.omc/state/last-tool-error.json`
- [ ] 仓库根加 `.gitignore` 含 `.omc/`
- [ ] BUDDY_STUB_CODEX 绕过 checkCodexAvailable
- [ ] hook preflight 时序：rotate sid 在 preflight 之前
- [ ] 测试 cleanup 改 BUDDY_HOME 路径（不直引 ${HOME}/.buddy）

### W11 — SKILL.md 同步新默认行为
- [ ] "对话协议"段：probe 默认走 broker 持久 thread；`--fresh-thread` 触发独立
- [ ] "注意事项"加：长 thread 会自动 compact；codex 有记忆，污染时手动 reset
- [ ] 行数监控 ≤150

### W12 — 长 thread compact（官方支持的 thread/compact/start）
- [ ] broker.threadCompact() 调用
- [ ] 触发条件：thread 累计 > N turns 或 token > 阈值（先用 turn count 简单做）
- [ ] **延后**：W7+W8 跑通真实数据后再决定阈值，不预设

---

## Acceptance Criteria

- [ ] 首次 probe lazy spawn broker，**用户感知 stderr 出现 `[buddy] broker spawned, ready`**
- [ ] 第二次 probe 复用 broker，stderr 出现 `[buddy] reusing thread <id>`
- [ ] `--fresh-thread` 真的独立（codex 不记得上一次）
- [ ] Claude session 结束自动清理 broker（hook 或 idle timeout）
- [ ] `codex resume <thread-id>` 在 codex CLI 能打开 buddy thread 复盘
- [ ] 51+/全 单测 pass
- [ ] verify-repo PASSED
- [ ] **broker 启动开销证据（Critic #1 修）**：固定 fixture prompt（`evals/bench-fixture.txt`，~1KB），同主机 warm 状态，N=5 次首次 probe（每次 SessionStart 重置）+ N=5 次复用 probe，**median 复用-首次 latency_ms 差 ≥ 5000**。脚本：`node scripts/buddy-bench.mjs --mode broker-startup-delta --runs 5 --prompt evals/bench-fixture.txt`
- [ ] **持久 thread 污染对照（Architect 加 + Critic #3）**：N=10 同主题 probe 跨 fixture 集（`evals/persistence-set/`），分别 `--fresh-thread` 和 默认持久跑，对比 verdict 分布。**verdict divergence rate < 20% → 持久默认可接受；≥ 20% → 不能合默认**
- [ ] **W11 文档化前置 gate（Critic #6 修）**：上面两个 acceptance 必须 pass 才推进 W11/W12，否则 plan rollback：`BUDDY_USE_LEGACY_EXEC=1` 设默认，broker 改 opt-in

## 风险

| 风险 | 缓解 |
|------|------|
| broker daemon 孤儿进程（Claude 异常退出/SIGKILL/OOM） | atexit 防优雅退出；不防 SIGKILL→ 检测算法：connect sock 失败 + PID 进程不存在（`process.kill(pid, 0)`）+ broker.json mtime > 1h → 视为 stale；`buddy-broker-cli stop --force` 直接 SIGTERM PID 并 unlink sock + lock |
| 多 worktree 同时跑 → sock 冲突 | sock 路径含 worktree hash |
| 长 thread 跑爆 token | thread/compact + warning |
| broker 协议 bug 导致 buddy 失效 | `BUDDY_USE_LEGACY_EXEC=1` fallback |
| 用户跨主题忘记 `--fresh-thread` 被污染 | jsonl 每 turn 入，事后能看到污染轨迹 + 加 `--reset-thread` 命令 |

## Build Order

```
W10 (cleanup, ~30min)         ← 先解锁 + 拿 stable baseline
   ↓
W7 (broker lifecycle, ~3h)
   ↓
W8 (thread persistence + actionProbe 接入, ~3h)
   ↓
W9 (first_byte fix + bench, ~1h)
   ↓
真实跑 ≥10 次 probe → 看数据
   ↓
W11 (SKILL.md 同步, ~30min)
   ↓
W12 (compact, 看数据再说)
```

总工时约 1-1.5 day（不含 W12）。

## ADR

**Decision**: lazy broker spawn + 默认持久 thread + `--fresh-thread` 逃生口。

**Drivers**:
1. Buddy 是会话伴侣不是工具——默认行为应贴合频繁触发模式（待 W9 数据：probe/session 频次预估 ≥3 才有意义）
2. 同主题深入时 codex 上下文记忆是优势——前提是同主题高频，跨主题靠 W6.5 tripwire 提示
3. 协议层防的是 **Claude 推理→prompt** 污染。**承认**：持久 thread 不防 **codex 自己的 prior turn → next answer** 污染；这是显式选择 vs 全 fresh，靠 W6.5 tripwire + W8 acceptance #2（divergence < 20%）兜底
4. 一个 thread = 一个时间线，审计/回溯/`codex resume` 都更顺
5. **承认成本**：持久 thread 让 codex 多次 probe 不再统计独立，"两模型不一致"的信号价值会被弱化。可接受是因为 W6.5 给了 tripwire + W8 给了数据 gate；不可接受时 `BUDDY_USE_LEGACY_EXEC=1` 兜底

**Alternatives considered**:
- A. 全 fresh thread（官方做法）：被否决——官方是工具（手动调用），buddy 是会话伴侣（自动触发）；fresh 让每次都重传完整证据，会话流水线感差
- C. 双模式 + 默认 fresh：steelman——`--persist` 显式让用户主动选记忆，安全保守。被否决因为 W9 假设同主题 probe 频次 ≥3/session，"每次 type --persist" 比"每次 type --fresh-thread" 更频繁，相同的认知负担选频率低的反向操作更合理。**条件**：W8 acceptance 显示 divergence ≥ 20% → 这条假设不成立 → rollback 到 C
- SessionStart 立刻 spawn：被否决——没用 V2 的 session 浪费 200MB；lazy 让首次 probe 多等 5-10s 是公平代价

**Why chosen**: B = lazy spawn + 持久默认 + 显式 fresh，三者结合既贴合 buddy 使用模式，又留逃生口。

**Consequences**:
- 短期：W4b 从"条件触发"变"必做"，Stage 5 工作量比原 plan 大 1 day
- 中期：codex 会有上下文记忆，可能有少量"污染"案例，靠 `--fresh-thread` + 事后 jsonl 审计兜底
- 长期：bench 数据真实可信，Stage 6+ 可以基于真数据做更激进优化

**Follow-ups**:
- W12 compact 阈值调参
- 跨主题自动检测 prompt（可选，先不做）
- 跨家族 buddy（Stage 6+）

---

## Changelog
- 2026-04-28：初稿，替换 plan v2 W4b
