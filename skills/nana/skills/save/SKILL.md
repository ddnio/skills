---
name: save
description: >
  Save current session context as a structured handoff snapshot.
  Trigger on: /nana:save, 'save session', 'save handoff', '保存会话', '保存上下文', '接力保存'.
---

# nana:save

从当前对话上下文生成结构化 handoff，写入 `.claude/handoff.md`，供新会话恢复使用。

## 执行步骤

### 1. 从对话上下文生成 handoff 内容

直接根据当前会话记忆生成以下结构，**不读任何文件，不运行任何命令**：

```
## 当前目标
<一句话描述当前在做什么>

## 已完成
- <item>

## 未完成 / 下一步
- <item>

## 关键文件
- <path>: <一句话说明>

## 重要上下文
<关键决策、约束、背景，2-5 条>
```

### 2. 写入文件

用 Write 工具将内容写入 `.claude/handoff.md`。

### 3. 确认输出

```
✓ 已保存到 .claude/handoff.md
  在新会话运行 /nana:load 恢复上下文
```
