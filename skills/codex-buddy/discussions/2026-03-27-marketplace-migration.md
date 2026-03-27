# 2026-03-27 Marketplace 迁移讨论

## 背景
用户提出研究 GuDaStudio/skills 项目，引发了将 codex-buddy 升级为插件市场的讨论。

## 研究过程

### 1. GuDaStudio/skills 分析
- Git submodule 聚合多个 skill，提供安装脚本
- 两个 skill：collaborating-with-codex、collaborating-with-gemini
- Python bridge 脚本封装 CLI 调用为统一 JSON 输出
- 没有验证机制、对话协议、反锚定设计
- 本质是 "CLI wrapper"，我们是 "协作协议"

### 2. anthropics/skills 分析（官方参考）
- 三层结构：marketplace → plugins → skills
- marketplace.json 用 `skills` 字段显式声明路径
- skill-creator 提供打包脚本，自动排除 evals/ 等开发资产
- `strict: false` 字段对齐
- 30+ 工具支持 Agent Skills 开放标准

### 3. obra/superpowers 分析
- 单 plugin 包含 14 skills
- SessionStart hook 注入元 skill 强制每次会话加载调度逻辑
- 五套适配层（Claude Code / Cursor / Codex / OpenCode / Gemini）
- skills/ 目录共享，适配层各自独立

## Codex Probe 结果（架构评估）

### 五个设计决策的判断
1. **验证协议分两层**：using-buddies 持有共享调度语义，各 buddy skill 持有执行语义
2. **单 plugin 多 skills** 优于多 plugin（第一阶段）
3. **开发资产不随 plugin 分发**：discussions/、evals/ 留在 repo
4. **治理分层重写**：根级（marketplace）+ skill 级（各 skill 独立）
5. **渐进式迁移**：先搬 → 验证分发 → 再加元 skill → 最后引入第二 buddy

### 最不确定的点
- using-buddies 职责边界（太强变薄壳，太弱变样板）
- SessionStart hook 跨平台一致性
- V-level 能否跨模型保持同一语义

## 决策

- 仓库名：`ddnio/skills`（后续转 `nanafox/skills`）
- 结构：参考 anthropics/skills 的 marketplace.json 格式
- 单 plugin `buddy-skills` 包含 codex-buddy skill

## 迁移执行

### Phase 1 完成
- 创建 ddnio/skills 仓库
- 迁移 codex-buddy 到 skills/codex-buddy/
- 添加 .claude-plugin/marketplace.json
- 创建根级 CLAUDE.md（分层治理）

### Codex Review 发现并修复的问题
| 问题 | 严重度 | 状态 |
|------|--------|------|
| verify-repo.sh 路径失效（REPO_DIR 指向 skill 目录但检查根级文件） | High | FIXED — SKILL_DIR/REPO_ROOT 分离 |
| sync-skill.sh 不同步 references/ | Medium | FIXED |
| 根级 README 手动安装指令不完整 | Medium | FIXED |
| marketplace.json 缺 strict 字段 | Low | FIXED |
| marketplace description 过度声明 Gemini | Low | FIXED |
| WORKFLOW.md 工作目录假设矛盾 | Medium | 留后续 |

## 后续待做
- Phase 2：运行时/开发资产分离
- Phase 3：多平台适配层（.cursor-plugin、.codex/、gemini-extension.json）
- Phase 4：using-buddies 元 skill + gemini-buddy
- WORKFLOW.md 路径更新
