# THE QUIBBLER

A **persona simulator**. Throw your stuff in — it brings in a roomful of 5-7 real people with different jobs, who actually use, watch, or read your material end-to-end, then tell you to your face what's wrong.

Not a quick glance and a comment. It **runs the code, opens the browser, reads the full text** — every claim backed by verifiable evidence.

[中文说明见下方](#中文说明)

---

## What it does

Classifies your material, casts 5-7 occupational personas from a 38-role library, dispatches them as concurrent subagents that actually experience the material (run the code, browse the page, read the text), then synthesizes a newspaper-style critical review with consensus, disputes, fatal flaws, and a prioritized fix list.

Supports 8 material types: `CODE` · `WEB` · `VIDEO` · `NOVEL` · `DOC` · `DESIGN` · `API` · `DATA` (combinable).

## Install

```bash
# From GitHub Agent Skills
gh skill install {owner} quibbler

# From SkillHub (CN)
skillhub install quibbler --namespace user_c18b02ff
```

Zero dependencies — Node 22+ built-in modules only.

## Usage

```
/quibbler --lite ./my-repo       # 3 personas, concise report
/quibbler --full ./demo           # 7 personas, full report
/quibbler --html ./project        # + newspaper-style HTML
```

## License

MIT

---

## 中文说明

# 《唱唱反调》THE QUIBBLER

一台**人群模拟器**。把你的东西丢进去，它替你请来一屋子性格迥异的真人 —— 一个一个用完、看完、读完，然后当面告诉你哪儿不行。

不是让模型看一眼点评两句，而是**真跑代码、真开浏览器、真读完全文**，每条结论都挂着可核对的证据。

## 安装

```bash
# GitHub Agent Skills
gh skill install {owner} quibbler

# SkillHub (国内)
skillhub install quibbler --namespace user_c18b02ff
```

零依赖，仅需 Node 22+。

## 用法

```
唱唱反调，看看 ./my-repo
帮我把这个仓库当新人接手一遍
这个视频发出去会被喷吗
/quibbler --lite ./demo
```

支持 8 类素材：`CODE` 代码 · `WEB` 网页 · `VIDEO` 视频 · `NOVEL` 小说长文 · `DOC` 文档PRD · `DESIGN` 设计稿 · `API` 接口SDK · `DATA` 数据报表。可组合（"带前端的开源仓库" = CODE + WEB）。

## 开关

| 开关 | 作用 |
|---|---|
| `--lite` | 3 角色 + 精简报告 |
| `--full` | 7 角色 |
| `--yes` | 跳过派发前的成本公示确认 |
| `--html` | 额外渲染报纸样式 HTML |
| `--roles A1,D6` | 强制指定角色 |
| `--out <dir>` | 覆盖默认报告目录 |

## 产物

```
{cwd}/.workbuddy/quibbler-reports/{素材名}-{日期}/
├── report.md      # 9 版面报纸式报告
├── report.html    # 可选
├── meta.json
├── evidence/{角色id}/   # 截图、日志、命令输出
└── roles/{角色id}.md    # 每人的完整原始体验日志
```

> 建议在 `.gitignore` 里加一行 `.workbuddy/`。技能只会提示，**不会替你改文件**。

## 脚本自测

```bash
node scripts/preflight.mjs --pretty
node scripts/inspect_material.mjs "<路径或URL>" --pretty
node scripts/init_workspace.mjs --name "我的 项目" --roles A3,B5 --pretty
```

三个脚本都支持 `--help`，输出唯一一个 JSON 到 stdout，诊断走 stderr，退出码 `0` 通过 / `1` 业务不合格 / `2` 运行错误。

> ⚠️ 跑链路测试时，`init_workspace.mjs` 必须显式带 `--cwd <临时目录>` 或 `--out <临时目录>`，否则产物会落在当前目录——技能包曾因此被 `.workbuddy/` 残留污染过。

## 已知限制

- **ffmpeg 本机缺失** → 遇到 VIDEO 素材时技能会自动尝试安装（`winget install Gyan.FFmpeg`，失败再试 scoop/choco），装好即正常体验；装不上才降级标 🔴。手动装也行：`winget install Gyan.FFmpeg`
- `agent-browser` 只能探测 CLI 是否存在，探不出浏览器能否真的启动；子代理首次调用失败时自行降级 🔴
- 单次运行的角色体验**互相隔离**，角色不会引用彼此观点 —— 这是刻意的，冲突留给报告的争鸣版
- 不做代码自动修复、不做打分排名、不做正向营销文案、不维护历史基线
- L 档大素材 v1 不做自动分段，靠 focus 分区自然错开覆盖面
- 同素材重跑目前只做检测与提示，增量 diff 体验尚未实现

## 设计原则

- **判定权归模型，计数权归脚本**：`scripts/*.mjs` 只做数得清、能被文件系统证伪的事；判型、选角、聚类全在 `references/` 里交给 Agent 语义执行
- **证据是地基**：`verify_report.mjs` 会逐个核对报告声明的 artifact 是否真实存在。编不出文件就编不出 🟢
- **零搬运**：`evidence/{角色id}/` 在派发前预建，子代理直接写约定路径
