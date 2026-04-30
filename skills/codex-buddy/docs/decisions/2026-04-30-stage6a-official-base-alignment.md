# Stage6a: 基座对齐官方 codex-plugin-cc

**日期：** 2026-04-30  
**分支：** feat/ux-stage1  
**关联 commits：** stage6a

---

## 决策背景

对照 `openai/codex-plugin-cc` 官方实现，发现 codex-buddy 基座层与官方存在以下 gap：

| 问题 | 旧实现 | 官方实现 |
|------|-------|---------|
| state 路径 | `~/.buddy/state/by-cwd/<sha256[:8]>.json` | `CLAUDE_PLUGIN_DATA/state/<slug>-<hash16>/` |
| workspace 解析 | raw `--project-dir`（无 git root） | `git rev-parse --show-toplevel` + `realpathSync` |
| hash 精度 | 8 位 hex（碰撞概率高） | 16 位 hex |
| CLAUDE_PLUGIN_DATA | 不支持 | 优先使用 plugin 环境注入路径 |
| SessionEnd cwd 解析 | `sed` 正则（fragile） | Node.js JSON.parse |

---

## 核心架构决策

**"基座对齐官方，智能触发层自建"**

```
┌─────────────────────────────────────────────────────────────┐
│                    智能触发层（我们独有）                      │
│  V-level / Floor Rules / 防锚定证据打包                       │
│  Probe-Followup-Challenge 对话协议                           │
│  annotate + metrics 学习闭环                                 │
│  SESSION_HANDOFF 跨 session 记忆                             │
└────────────────────────┬────────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────────┐
│              基座层（对齐 codex-plugin-cc）                   │
│  State 路径 / Broker 生命周期 / Session hooks                │
└─────────────────────────────────────────────────────────────┘
```

---

## 实施内容

### `scripts/lib/paths.mjs` 重写

新增两个函数：
- `resolveWorkspaceRoot(cwd)` — `git rev-parse --show-toplevel`，失败回退到 `path.resolve(cwd)`
- `resolveStateDir(cwd)` — `CLAUDE_PLUGIN_DATA/state/<slug>-<hash16>/`，fallback 到 `$BUDDY_HOME/state/`
- `resolveBuddySessionFile(cwd)` — convenience wrapper

**路径优先级：**
1. `$CLAUDE_PLUGIN_DATA/state/` — Claude Code plugin 环境
2. `$BUDDY_HOME/state/` — BUDDY_HOME override（测试/CI）
3. `~/.buddy/state/` — 个人安装 fallback

### `scripts/lib/codex-adapter.mjs` 更新

- `saveBuddySession`: 使用 `resolveBuddySessionFile(cwd)` 写 primary state
- `loadBuddySession`: 3 层 fallback（新格式 → stage5e legacy → 全局 legacy）
- 保留 `~/.buddy/buddy-session.json` legacy 写入（back-compat）

### `hooks/session-end` 补强

- 用 Node.js 内联 JSON.parse 替代 sed 解析 cwd
- 移除 `set -e`（best-effort cleanup，不应中断 session 结束流程）
- 注释明确标注：persistent learning data（logs.jsonl、sessions/）**不清理**

---

## 重要边界：不对齐的部分

官方有 `state.jobs[]`、`generateJobId()`、job-control.mjs——这些属于任务委托模型，我们不需要。  
我们的 `buddy_session_id`、`logs.jsonl`、`sessions/` 是认知验证模型的独有数据结构。

**"对齐"= 对齐路径解析机制和 lifecycle 模式，不是对齐数据结构。**

---

## Codex probe 记录

本次决策经两轮 Codex 独立审查（`~/.buddy/logs.jsonl`，buddy_session_id: buddy-89c8b2e1）：

**Probe 1** (`vtask-mokxjk5k-c3f2f3aa`) — gap 优先级评估  
verdict: caution | 关键发现：SessionEnd 已存在但实现不完整，C8 job-control 面暂不需要

**Probe 2** (`vtask-mokziebh-c77ceb55`) — 分层架构评估  
verdict: caution | 关键发现：C2 teardown 不能清学习数据，C7 SESSION_HANDOFF 污染仓库风险

---

## 测试覆盖

- 新增 `scripts/lib/__tests__/paths.test.mjs`：13 个测试，覆盖 getBuddyHome/resolveWorkspaceRoot/resolveStateDir/resolveBuddySessionFile
- 更新 `buddy-session.test.mjs`：stage5e → stage6a 路径格式断言
- 全量：113/113 通过

---

## 后续待处理

- [x] SESSION_HANDOFF.md 移出 git 跟踪目录 — **Stage6c (commit 70e775a) 已关闭**：git rm --cached，读路径改为 `~/.buddy/handoff-<cwdHash8>.md`，legacy fallback 保留
- [x] L3 重新验证：probe 实测写入确认 ✅（sessions/buddy-bc506228.jsonl，22 事件）
- [x] Stop hook（W-015）— **Stage6c (commit 70e775a) 已关闭**：PreToolUse advisory hook，不是 gate 模式，符合实际需求
