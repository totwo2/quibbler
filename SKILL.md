---
name: quibbler
slug: quibbler
displayName: 唱唱反调 The Quibbler
summary: 人群模拟器 — 5-7 个职业角色真体验素材后合成报纸感锐评报告，防子代理摸鱼。
description: This skill should be used when the user wants a multi-persona deep-experience critique of an artifact — a code repository, web page, video, novel or long-form text, PRD/document, design mockup, API/SDK, or data report. It classifies the material, casts 5-7 occupational personas from a built-in 38-role library, dispatches them as concurrent subagents that actually run the code, open the page in a real browser, or read the text end-to-end, and then synthesizes a newspaper-style critical review with consensus, disputes, fatal flaws, and a prioritized fix list. Trigger on "唱唱反调", "quibbler", "深度体验", "多角色评审", "找人试试", "模拟用户", "会被喷吗", "挑刺", "找茬", "体验报告", "多视角审查", "roast my project", "critique this", "multi-persona review", "find the flaws", "red team", or "/quibbler". Do not use for simple explanation, code modification, or requests for positive marketing copy.
agent_created: true
version: 1.0.0
license: MIT
tags: [review, critique, persona, quibbler, 唱唱反调]
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch, Skill, Agent
---

# 《唱唱反调》THE QUIBBLER

一台**人群模拟器**：把东西丢进去，它替你请来一屋子性格迥异的真人，一个一个用完、看完、读完，然后当面告诉你哪儿不行。

## 三条锁定决策（不再讨论）

1. **体验优先、锐评收尾** —— 子代理必须先老实完整体验一遍并记录真实卡点，最后才下判断。**可信度 > 毒舌**。
2. **按素材类型自动选角** —— 38 人角色库，依素材类型自动挑 5–7 人，用户可覆盖。
3. **能真跑就真跑** —— 代码真运行、网页真打开、文档真读完。跑不动才降级推演，且必须标注。

---

## 1. 何时用 / 何时不用

### 1.1 应当触发（S 系列）

| # | 用户说法 | 推断类型 | 意图 |
|---|---|---|---|
| S1 | "帮我看看这个页面，找几个人来试试" | WEB | 可用性 + 转化诊断 |
| S2 | "把这个仓库当新人接手一遍" | CODE | 可维护性 + 上手成本 |
| S3 | "这章小说读者会怎么想" | NOVEL | 读者留存 + 编辑视角 |
| S4 | "这个视频发出去会被喷吗" | VIDEO | 完播 + 舆情风险 |
| S5 | "我这 PRD 评审会被怼成什么样" | DOC | 评审预演 |
| S6 | "审一下这个 SDK 的接入文档" | API | 集成开发者体验 |
| S7 | "这份周报别人看得懂吗" | DATA | 口径与可读性 |
| S8 | "找一屋子人喷一下我这设计稿" | DESIGN | 视觉 + 无障碍 |
| S9 | "深度体验一下" / "/quibbler" | 任意 | 显式调用 |

**关键词族**：唱唱反调、Quibbler、深度体验、多角色评审、找人试试、模拟用户、用户会怎么想、会被喷吗、挑刺、找茬、体验报告、多视角审查。

### 1.2 不应触发（N 护栏，逐条自检后才准往下走）

| # | 场景 | 正确行为 |
|---|---|---|
| N1 | 只是问"这段代码是什么意思" | 直接解释，末尾附一句"要做多角色深度体验吗？" |
| N2 | 要求**修改 / 实现 / 重构** | Quibbler 只诊断不动手。走正常开发流程，改完可建议跑一次 |
| N3 | 素材过小（<30 行代码 / <200 字 / 单个图标） | 降级 1–2 角色单人快评，并告知用户"多角色是浪费" |
| N4 | 明说"简单说""快速看一眼""一句话总结" | 单 Agent 简答 |
| N5 | 想要正面文案 / 宣传语 / 好评 | 说明本技能是批评导向，转文案流程 |
| N6 | 纯检索、日期计算、翻译等确定性任务 | 直接执行 |
| N7 | 素材无法访问（私有仓库 / 付费视频 / 需登录无凭据） | 先索要访问方式；用户坚持则明确声明"本次为全推演模式" |
| N8 | 同会话对**同一未改动素材**已跑过 | 询问：复用上次报告 / 全量重跑 / 只看 diff |

> **护栏优先于热情。** 命中任一 N 条就停，别为展示能力硬召唤六个人。

---

## 2. CLI 开关

| 开关 | 作用 |
|---|---|
| `--lite` | 3 角色 + 精简报告（专业 1 + 外行 1 + 敌对 1） |
| `--full` | 7 角色 |
| `--yes` / `--no-confirm` | 跳过派发前的成本公示确认 |
| `--html` | 额外渲染报纸样式 `report.html` |
| `--roles A1,D6` | 强制指定角色，挤掉同席位优先级最低者 |
| `--out <dir>` | 覆盖默认报告根目录 |

无开关时默认：M 档 6 人、需确认、只出 Markdown。

---

## 3. 六阶段主流程

> 每阶段固定三件事：**做什么 → 读哪个 reference → 跑哪个脚本**。不要跳阶段。
> 脚本走系统 `node`（`preflight.mjs` 探测缺失并回显 `node_path`）；必要时回退 WorkBuddy 自带运行时，内部均用 `node:` 内置模块，不写死版本路径。
> 所有传给 Bash 的路径**必须双引号包裹**。

### 阶段 0 · 护栏与意图解析

1. 逐条过 §1.2 的 N1–N8。命中即按"正确行为"处理并终止。
2. 解析 CLI 开关与用户显式指定的角色 / 临时角色描述。
3. 确认素材位置：本地路径、URL、还是用户直接贴的文本（贴的文本先落盘到临时文件再走后续流程）。

**产出**：`mode`（default/lite/full）、`user_pins[]`、`source`。

### 阶段 1 · 双探针（并行）

在**同一条消息里**发两个 Bash 调用，别串行：

```bash
node "scripts/inspect_material.mjs" "<素材绝对路径或URL>"
node "scripts/preflight.mjs" --out "<系统临时目录>/quibbler-envprobe-<时间戳>.json"
```

- `inspect_material.mjs` → `MaterialProfile`（`type_signals`/`ext_histogram`/`entrypoints`/`lines`/`words`/`duration_s`/`size_tier`，**不判型，`types` 恒为空**）。
- `preflight.mjs` → `EnvProbe`：`missing` / `install_hints` / **`forced_red_scopes`**。
- `preflight.mjs` 额外把 `EnvProbe` 落盘到 `--out` 并回显 `envprobe_path`（阶段 4.1 传给 `init_workspace.mjs --env-probe`）。

**`forced_red_scopes` 是硬约束**：里面列出的动作在本机物理上做不到，任何子代理声称对它 🟢 都是伪造证据。

若 `access_ok: false` → 走 N7。

### 阶段 2 · 判型与选角

1. **读 `references/material-typing.md`** → 依信号表定 `types[]`（最多 3 个）与 `size_tier`，并取出 `key_actions[]`。判不准就问用户，别猜。
2. **读 `references/roles/index.yaml`**（6KB 精简索引，38 条）。
3. **读 `references/casting-rules.md`** → 按八步检查表选人：席位配额 → Jaccard 重叠校验 → 用户指定覆盖 → 体量调人数 → **focus 分区**。
4. **只读命中的分组文件**（通常 1–3 个）提取完整角色卡：
   `references/roles/group-a-tech.md` / `group-b-product.md` / `group-c-content.md` / `group-d-outsider.md` / `group-e-crossover.md`
5. 为每人写一句 `rationale`（"为什么是他"），进公示卡与报头。

**两条硬校验，不满足不许往下走**：
- ❗ **敌对席非空**（D6 / E8 / B1，见角色库）
- ❗ **边缘用户席非空**（B5 / D7 / D8 / D9 / D10，见角色库）
- 纯 CODE 无自然边缘用户时，由 A3 林接盘 或 D3 丁三分钟 顶替边缘席。

**选角定稿后写一份临时 casting JSON**（阶段 4.1 传给 `init_workspace.mjs --casting`），元素形状：

```json
[
  { "role_id": "A3", "seat": "professional_core", "planned_actions": 4, "rationale": "最先接手的人" },
  { "role_id": "E8", "seat": "adversary",        "planned_actions": 3, "rationale": "预演被怎么骂" },
  { "role_id": "B5", "seat": "edge_user",        "planned_actions": 2, "rationale": "读屏与键盘" }
]
```

- `seat` 取值域：`adversary` / `edge_user` / `professional_core` / `layman` / `crossover`（与 `casting-rules.md` 一致，不要另起命名）。
- **`planned_actions` = 该角色 Brief 里「必须尝试的关键动作」条数**，是覆盖度分母（`coverage` / `CASTING_MISMATCH` 都靠它）。**务必如实填**：多填虚高、少填报偏差。
- 该文件 `role_id` 集合须与 `--roles` 一致，否则 `init_workspace.mjs` 直接报错退出（提前抓出拼错参数）。

### 阶段 3 · 成本公示与确认（**不许跳过，除非 `--yes`**）

派发前必须向用户出示下面这张卡并等待确认（**花用户钱前的最后一道闸**）。

```
📰 《唱唱反调》即将开印

素材：my-repo（CODE + WEB，M 档，18,422 行）
本期阵容（6 位）：
  · A3 林接盘  后端新人      专业内核席 —— 你这仓库最先接手的人就是他
  · A2 韩渗透  应用安全      专业内核席 —— 有 .env 和外部接口，必须过一遍
  · A6 苏边界  QA            专业内核席 —— 边界与异常路径
  · D3 丁三分钟 摸鱼实习生    外行真人席 —— 测"抄不抄得动"
  · B5 顾无碍  无障碍顾问     边缘用户席 —— dist/ 里有前端，键盘与读屏必查
  · E8 卓对手  竞品 PM        敌 对 席 —— 预演"这东西多久能被抄完"
环境：ffmpeg 缺失（本次不涉及视频，无影响）
预计：10–15 分钟，约 6 个子代理 × 12 次工具调用
产物：.workbuddy/quibbler-reports/my-repo-2026-08-07/

开印吗？（回复"开"或调整阵容；下次可用 --yes 跳过本确认）
```

**填写规则**：素材行照抄 `MaterialProfile`；阵容每行 `{id} {姓名}｜{职业}｜{席位}｜{rationale}`；环境行写 `EnvProbe.missing` 及影响；耗时按 `size_tier` 查表（S 6–9 / M 10–15 / L 14–22 分）；产物路径写阶段 4 将建目录。

用户回"开" → 继续；换人 → 回阶段 2 第 3 步重选并**重新公示**。

### 阶段 4 · 建工作区 → 并发派发 → 回收校验

**4.1 建工作区**

```bash
node "scripts/init_workspace.mjs" --name "<素材名>" --material "<绝对路径>" --roles A3,A2,A6,D3,B5,E8 --types CODE,WEB --mode default --env-probe "<阶段1记住的 envprobe_path>" --casting "<阶段2写的 casting JSON 路径>" --access-status "<granted|refused|unknown>"
```

产出 `workspace` 绝对路径，预建 `evidence/{ROLE_ID}/`/`roles/`/`meta.json`，及 `.gitignore` 提示（转达用户即可，绝不自动改）。

`--env-probe` / `--casting` / `--access-status` 三项把上游探针、阵容、访问状态写进 `meta.json`，从而**激活 verify 里的 `FALSE_ENV_EXCUSE` / `FALSE_ACCESS_EXCUSE` / `CASTING_MISMATCH` 三道反撒谎闸门**。三者均可省略（向后兼容），但省略后 verify 只会退化为 `UNKNOWN` 告警而非硬失败——那等于闸门没通电，见阶段 5。

**4.2 拼 Brief**

读 `references/subagent-prompt-template.md`（Brief 唯一真源）与 `references/dxp-protocol.md`（七步执行细则），为每人渲染 Brief，注入：完整角色卡、`MaterialProfile`、`EnvProbe`、**互斥 `assigned_focus`**、`key_actions`、预算、**绝对路径** `evidence_dir`、`forced_red_scopes`。

> 子代理的 cwd 不可信。Brief 里所有路径一律**绝对路径**。

**4.3 并发派发**

在**同一条助手消息内**发出 N 个 `Agent` 工具调用 —— 这就是本 CLI 的并发语义，**不要串行 await**。`subagent_type` 用 `general-purpose`（需要 Bash/Write/Read 全集，只读型 agent 写不了证据文件）。

**4.4 回收校验**

读 `references/subagent-return-schema.md`，逐份跑校验清单。命中任一违规码即**打回重试一次**（只一次）：

| 违规码 | 谁来判 |
|---|---|
| `PARSE_FAIL` · `EVIDENCE_MISSING` · `RED_NO_REASON` · **`ARTIFACT_DANGLING`** · **`ARTIFACT_REQUIRED`** · **`REASONING_NOT_RED`** · `CREDENTIAL_ECHO`（→ `CREDENTIAL_LEAK`） · **`P0_MIXED_SIGNAL`** · **`DILIGENCE_RATE_INFLATED`** · **`HIGHLIGHT_OVERFLOW`** · **`UNKNOWN_TOOL`** | 🔒 **机器硬门禁**，`verify_report.mjs` 自动判定并 exit 1 |
| `MISSING_STEP` · `EDGE_TOO_FEW` · `CURVE_BAD` · `NO_HIGHLIGHT` · `ADJECTIVE_LEAK` | 👁 **模型软自查**，脚本**零实现**，须由主 Agent 在本阶段逐份人工核对 |

> ⚠️ 别把 👁 那一行当成脚本会帮你拦。`verify_report.mjs` 里没有这 5 个码的任何实现——
> 它们只在回收阶段靠主 Agent 读日志判断。跳过这一步，缺步骤 / 边缘用例太少 / 形容词注水
> 这几类问题会一路带进终版报告，脚本一句话都不会说。
> （🔒/👁 的完整对照见 `references/subagent-return-schema.md` §6 V1–V14 表的「机检」列。）

二次仍失败 → 该角色 `experience_completed: false`，结论证据等级上限压到 🟡，**不计入共识人次**，末版《更正与声明》登记。

### 阶段 5 · 合成、出报、体检回填

1. 写 `roles/{ROLE_ID}.md` ×N（完整原始体验日志，人读版，**不许改角色语气**）。
2. **读 `references/synthesis-rules.md`** → 共识聚类（≥2 人**独立**提及）、分歧配对、致命伤遴选、亮点汇总、风险预报、P0/P1/P2 定级。
3. **读 `references/report-template.md`** → 写 `report.md`，9 版面 H2 锚点**逐字不可改**，报头指标先留 `{{PLACEHOLDER}}`。
4. 体检：

```bash
node "scripts/verify_report.mjs" "<workspace>" --secrets-from-stdin
```

退出码 `0` 通过 / `1` 有违规 / `2` 运行错误。有违规 → 逐条改 `report.md` 后重跑，**最多 2 轮**。

> ⚠️ **闸门通电检查**：若 `meta.json` 缺 `env_probe` / `access_status` / `casting` 任一项，`verify` 只会退化为 `ENVPROBE_UNKNOWN` / `ACCESS_STATUS_UNKNOWN` / `PLANNED_ACTIONS_UNKNOWN` 告警而非硬失败——这**不是通过，是闸门没通电**。看到 exit 0 却带这类告警，须回头用阶段 4.1 三参数补数据重跑，否则 `FALSE_ENV_EXCUSE` / `FALSE_ACCESS_EXCUSE` / `CASTING_MISMATCH` 三道反撒谎闸门是死的。
> 尽责率 `diligence_rate` < 85% 时，`verify` 默认报 `LOW_DILIGENCE` 阻断（exit 1）；想临时看报告可加 `--soft-diligence` 降为告警（不阻断）。退出码语义以本文件为准（0/1/2），任务消息称"2=告警"作废。

5. 用脚本返回的机器指标**回填**报头：**双指标**——`real_exec_rate`（真实执行率，对用户，不设下限）+ `diligence_rate`（尽责率，对技能，≥85% 硬验收），外加 `coverage`。**禁止手写估算。**
6. `--html` 时：读 `references/html-report.md`，跑 `node "scripts/render_html.mjs" "<workspace>"`，内联 `assets/report-newspaper.css`。
7. 向用户输出完整 Markdown 报告 + 落盘路径 + `.gitignore` 提示。

---

## 4. 并发派发要点

- **单条消息内多个 Agent 调用 = 真并发。** 这是唯一正确姿势。
- **默认 6 人**；`--lite` 3、`--full` 7、S 档自动 3。
- **降级三层**：
  1. 6 并发 → 若配额/并发错误或 ≥2 人未返回；
  2. → **3 + 3 两批**（先派 专业内核 + 敌对，再派 外行 + 边缘 + 外脑）；
  3. → 仍失败则逐个串行，并**向用户明示"本次为串行模式，耗时将拉长"**；
  4. 单角色失败不阻塞整体，标 `experience_completed: false` 并在末版登记。
- **子代理禁止再嵌套调用 `Agent` 工具**（会导致成本失控）。Brief 里已写明这条禁令。
- **打回只重试一次**。第二次还不行就诚实降级，不要无限重试烧钱。

---

## 5. 不可违反的红线

1. **只读素材** —— 不改用户一个字节。必须安装依赖或构建时优先在临时目录操作；若不得不在原地产生 `node_modules/dist`，在日志中如实记录。
2. **🔴 推演条目不得进入 P0 修复清单** —— 只能进 P1/P2 并附"需人工确认"。
3. **不伪造执行证据** —— `artifact` 路径会被 `verify_report.mjs` 逐个核对是否真实存在于磁盘。编不出文件就编不出 🟢。
4. **凭据不落盘、不入证据、不进报告** —— 凭据只活在会话内存与 Brief 里，返回内容一律写 `***`。凭据字符串通过 **stdin**（不走 argv）传给 verify 做全文扫描，命中即红线失败，必须先清理再交付。
5. **每个角色至少 1 条被低估的亮点** —— 硬性要求，防止报告沦为无差别扫射。
6. **角色不得引用其他角色观点** —— 独立性是多视角价值的前提。冲突由主编（你）在争鸣版处理。
7. **报头指标一律脚本回填，模型不得手写估算**——绝不能自己给自己打分；`diligence_rate` 不达标即 `LOW_DILIGENCE` 阻断。
8. **第 6 步之前禁止评价性形容词** —— 前 5 步只写事实与即时感受。违禁词清单见 `dxp-protocol.md`。

---

## 6. references 加载路由表（渐进式披露）

**不要一次性全读**：按阶段按需加载，读完即弃。

| 阶段 | 需要时读取 | 用途 |
|---|---|---|
| 2 | `references/material-typing.md` | 判型 + 体量分档 + 取关键动作 |
| 2 | `references/roles/index.yaml` | 38 条精简索引，选角唯一数据源（6KB） |
| 2 | `references/casting-rules.md` | 席位配额 / Jaccard 校验 / focus 分区 八步检查表 |
| 2 | `references/roles/group-{a,b,c,d,e}-*.md` | **只读命中的 1–3 个分组**，提取完整角色卡 |
| 4 | `references/subagent-prompt-template.md` | Brief 唯一真源，10 段模板 + 占位符字典 + 3 个示例 |
| 4 | `references/dxp-protocol.md` | DXP 七步细则、证据三级规范、预算收敛规则 |
| 4 | `references/subagent-return-schema.md` | ExperienceLog schema + 校验清单 + 打回话术 |
| 5 | `references/synthesis-rules.md` | 共识/分歧/致命伤/风险合成算法与定级规则 |
| 5 | `references/report-template.md` | 9 版面骨架、H2 锚点、报头占位符、空版处理 |
| 5 | `references/html-report.md` | `--html` 时的栏目映射与情绪曲线 SVG 规则 |

**子代理永远不加载角色库文件**——角色卡已注入 Prompt。

| 脚本 | 阶段 | 一句话 |
|---|---|---|
| `scripts/inspect_material.mjs` | 1 | 数清素材，只给信号不判型 |
| `scripts/preflight.mjs` | 1 | 探环境，产出 `forced_red_scopes` |
| `scripts/init_workspace.mjs` | 4 | 建目录骨架 + 预建 `evidence/{ROLE_ID}/` |
| `scripts/verify_report.mjs` | 5 | 报告体检，指标机器回填，可信度最后一道闸 |
| `scripts/render_html.mjs` | 5 | 报纸样式 HTML（`--html`） |

---

## 7. 落盘与清理

```
{cwd}/.workbuddy/quibbler-reports/{material-slug}-{YYYY-MM-DD}[-{n}]/
├── report.md          # 9 版面主报告
├── report.html        # 可选，--html
├── meta.json          # 素材指纹、阵容、环境探针、时间戳
├── evidence/
│   ├── INDEX.md       # verify_report.mjs 生成
│   └── {ROLE_ID}/{NN}-{slug}.{ext}
└── roles/{ROLE_ID}.md # 完整原始体验日志
```

- **slug**：剔除 `<>:"/\|?*` 与控制字符，空格→`-`，保留中文，截断 40 字符，空则用 `material`。
- **同日冲突**：追加 `-2`、`-3`。
- **`.gitignore`**：`init_workspace.mjs` 检测到 cwd 是 git 仓库且 `.workbuddy/` 未被忽略 → 把提示原样转达用户，**不替用户改文件**。
- **证据命名**：`evidence/{ROLE_ID}/{NN}-{slug}.{ext}`，`NN` 从 `01` 起两位补零。
- **报告内引用**：一律相对 `report.md` 的相对路径，用 `/` 分隔。
- **时间**：体验日志内用相对时间 `mm:ss`；meta.json 用 ISO 8601；目录日期段用本地 `YYYY-MM-DD`。

---

## 8. 故障处置

| 故障 | 处置 |
|---|---|
| **ffmpeg 缺失**（本机当前即此状态） | `types` 含 VIDEO：**自动安装**——优先 `winget install Gyan.FFmpeg`，失败再试 `scoop install ffmpeg` / `choco install ffmpeg`，装完重跑 `preflight` 核验；安装成功 → 正常体验视频。安装失败（无网络 / 无权限等）→ 问用户"手动装还是继续（全 🔴）"；选继续 → `forced_red_scopes` 注入所有 VIDEO 角色 Brief，C4 秦帧 / C6 江分贝 整段标"纯推演"、不计入共识人次、真实执行率如实下降**不美化**，末版登记安装命令 |
| **需登录** | 向用户索要凭据；不给 → 声明"全推演模式"（N7），给了 → 只存会话内存、Brief 三重禁令，交付前必跑凭据泄漏扫描 |
| **`agent-browser` 不可用** | `preflight` 只探 CLI 存在性，探不出浏览器能否启动；子代理首调失败**自行降级 🔴** 并写明原因，勿反复重试 |
| **素材过小** | 走 N3，降级 1–2 角色快评，明确告知用户 |
| **子代理失联 / 超时** | 按 §4 三层降级。单人失败不阻塞，标 `experience_completed: false` |
| **子代理返回不是合法 JSON** | `PARSE_FAIL`，打回一次并附原始返回。二次失败即降级 |
| **同素材重跑** | 检测到同日同素材目录 → 询问"复用 / 全量重跑 / 只看 diff"；v1 仅检测提示，真 diff 归 P1 |
| **verify 报 `RED_IN_P0`** | 把该条从 P0 移到 P1 并加"需人工确认"，重跑 verify |
| **verify 报 `credential_leak: true`** | **停止交付**。定位泄漏文件，清理后重跑，直到 false 才能给用户 |
| **中文 / 空格路径报错** | 路径全程双引号包裹（见 §3 阶段 0）；脚本已用 `node:path`，勿手拼分隔符 |

---

## 9. 自检清单（交付前逐条打勾）

- [ ] N1–N8 护栏过了一遍
- [ ] 敌对席、边缘用户席均非空
- [ ] 派发前出了成本公示卡并拿到确认（或用户用了 `--yes`）
- [ ] 每个角色的 `assigned_focus` 互斥，无重复关注点
- [ ] 每份 ExperienceLog 都过了 schema 校验
- [ ] 9 个 H2 锚点齐全，空版也保留标题并写"本期无"
- [ ] 报头指标是 `verify_report.mjs` 的机器值，不是手写
- [ ] 没有 🔴 条目混进 P0
- [ ] `credential_leak: false`
- [ ] 每个角色至少 1 条被低估的亮点
- [ ] 落盘路径与 `.gitignore` 提示已转达用户
