# HTML 报纸报告 · 使用与字段映射说明

> 配套脚本：`scripts/render_html.mjs` + `assets/report-newspaper.css`
> 触发时机：P1 阶段，编排层在 `verify_report.mjs` 通过（`exit 0`）后调用，将 `report.md` 转成报纸版 `report.html`。
> 设计纪律：渲染脚本**只做格式转换，不做任何语义判断**。所有"该不该算"的判定都在 `verify_report.mjs` 里完成。

---

## 1. 调用方式

```bash
# 最简：传入 workspace 目录（自动找 report.md），输出到同目录 report.html
node scripts/render_html.mjs "<workspace>"

# 显式指定 report.md 或目录
node scripts/render_html.mjs "/path/to/report.md"

# 自定义输出路径与标题
node scripts/render_html.mjs "<workspace>" --out dist/issue-007.html --title "第 007 期 · 唱唱反调"

# 看帮助（无参数或 --help 也行）
node scripts/render_html.mjs --help
```

- 输入是**目录**时，脚本取 `<dir>/report.md`；输入是**文件**时直接用。
- `--out <file>`：输出 HTML 路径，缺省为 `report.md` 同目录的 `report.html`。
- `--title <t>`：`<title>`，缺省 `《唱唱反调》THE QUIBBLER`。
- **零 npm 依赖**，仅用 node: 内置模块；样式表从 `../assets/report-newspaper.css` 读取并内联进 `<style>`，便于单文件分发。

### 退出码

| 码 | 含义 |
|---|---|
| `0` | 成功生成 HTML |
| `1` | 输入不合格（路径不存在 / 找不到 report.md） |
| `2` | 运行错误（异常未捕获） |

### stdout / stderr 契约

- **stdout**：唯一一个 JSON 对象，字段：`schema_version`、`html_path`、`bytes`、`sections`、`curves`、`css_inlined`。
- **stderr**：人类可读诊断（`[html] 已生成：…（N 个版面 / M 条情绪曲线）`）。

---

## 2. 支持的 Markdown 子集

渲染器是**纯行解析**的子集实现，支持：

| 源 | 渲染为 |
|---|---|
| 围栏代码块 ```` ``` ```` | `<pre class="block"><code>`（指标块本身即代码块，照常上色） |
| HTML 注释 `<!-- … -->` | 原样保留、渲染不可见（机器标记不进版面） |
| 表格（含分隔行） | `<div class="table-wrap"><table>`；见 §3 列映射 |
| 三行情绪曲线表 | `<figure class="curve"><svg>`；见 §4 |
| `#`–`######` 标题 | `<h1>`–`<h6>`；`##` 切面自动包 `<section class="page">` |
| `>` 引用块 | `<blockquote>`（连续行合并，换行转 `<br/>`） |
| `---` / `***` | `<hr/>` |
| `-` / `*` 无序列表 | `<ul><li>` |
| 普通段落 | `<p>` |

行内标记：`code` → `<code>`、`[label](href)` → `<a>`、`**粗**` → `<strong>`、`*斜*` → `<em>`。
所有文本先 `escapeHtml` 再注入，杜绝注入风险。

---

## 3. 表格列映射（通用规则）

非情绪曲线的普通表格，逐列按 DOM 顺序渲染，**没有"魔法列"**：

- 表头行 → `<thead><tr><th>`。
- 数据行 → `<tbody><tr><td>`，单元格数无所谓，按实际渲染。
- 单元格内**若含证据标签或徽章文案**，会被 §5 的上色规则命中（`decorate`）。
- 《分类广告栏》FIXLIST 表、`evidence` 索引表等一律走此通用路径——脚本不区分版面，只区分"是不是三行情绪曲线表"。

---

## 4. 情绪曲线 SVG 规则（重点）

### 4.1 触发识别

渲染器逐表检查表头**第一个单元格**：

- 第一格等于 **`时刻`** → 视为情绪曲线表，进入 `curveToSvg`。
- 否则走 §3 通用表格路径。

### 4.2 表格三行写法（与 report-template.md §4.5 一致）

```markdown
| 时刻 | 00:00 | 00:04 | 00:11 | 00:18 | 00:25 |
|---|---|---|---|---|---|
| 体感 | 6 | 3 | 1 | 2 | 3 |
| 心声 | 试试看 | 又是环境问题 | 我是不是不适合干这行 | 好歹跑起来了 | 明天再说吧 |
```

- **行 1（表头）**：首格 `时刻`，其余为采样点标签（5–8 列，对应 5–8 个采样时刻）。
- **行 2（体感）**：首格 `体感`，其余为 **0–10 数值**（体感分）。缺失或非数字按 `0` 计。
- **行 3（心声）**：首格 `心声`，其余为该时刻的内心独白文字（可选，缺失则只画点不画旁白）。

### 4.3 渲染约束（脚本内部）

| 项 | 规则 |
|---|---|
| 采样点数 `n` | 取 `min(标签数, 体感数)`；**`n < 2` 直接放弃 SVG**，退回普通表格渲染，避免退化折线 |
| 分数范围 | `clamp(0, 10)`；超界自动夹到边界 |
| 画布 | `viewBox="0 0 720 220"`，左/右/上/下留白固定，等分 `stepX` |
| 网格 | 画 `0 / 5 / 10` 三条横线 + Y 轴刻度文字 |
| 折线 | `<polyline class="line">`，点集 `x,y` 保留 1 位小数 |
| 数据点 | 每个点一个 `<circle class="dot">`，`<title>` 含 `时刻 · 分数 · 心声`（悬停可见），上方标分数，下方标时刻标签 |
| 落版 | 包 `<figure class="curve">`，底部 `<figcaption>情绪曲线（0–10 分，悬停看心声）</figcaption>` |

> 若 `体感` 行缺失，直接不渲染 SVG（退回普通表）。`心声` 行缺失仍可渲染，只是没有旁白 `<title>`。

---

## 5. 徽章与证据标签上色

`decorate()` 对**全文（含代码块）**做字符串替换上色。命中规则按下方文案精确匹配：

### 5.1 证据标签（前置 emoji）

| 原文 | 着色 class |
|---|---|
| `🟢` | `<span class="ev ev-green">` |
| `🟡` | `<span class="ev ev-yellow">` |
| `🔴` | `<span class="ev ev-red">` |
| `🛡` | `<span class="ev ev-shield">` |

### 5.2 指标徽章

| 原文文案 | 着色 class | 语义 |
|---|---|---|
| `❌ 低于 85% 门槛` | `badge badge-danger`（红） | 尽责率低于门槛 |
| `✅ 可执行范围内已尽责` | `badge badge-ok`（绿） | 尽责率达标 |
| `— 本次无可执行范围` | `badge badge-mute`（灰） | 无可执行范围 |
| `⚠️ 环境受限` | `badge badge-warn`（灰） | 真实执行率受限（有可免责 red） |
| `✅ 无环境限制` | `badge badge-ok`（绿） | 真实执行率无环境限制 |

> 这些文案由 `verify_report.mjs` 的 `buildFills()` 在 `--write-back` 时填入刊号栏指标表，因此"先 verify 写回、再 render"的顺序能保证徽章正确上色。

---

## 6. 样式表与版式

- `assets/report-newspaper.css` 提供：纸张卡片 `.paper`、双线分隔的 `h2` 版面头、表格、证据色块、徽章、情绪曲线 `<figure>`、打印（双栏 + 链接展开）与窄屏（`max-width:640px`）适配。
- 渲染时样式**内联**进 HTML，单文件即可在浏览器/打印中独立呈现，无需附带 css。

---

## 7. 常见坑

- **顺序**：务必先跑 `verify_report.mjs --write-back`（填指标徽章文案）再 `render_html.mjs`，否则徽章文案是 `{{DILIGENCE_BADGE}}` 这类占位符，上色规则命中不到。
- **情绪曲线被当普通表**：检查首格是不是 `时刻`、有没有 `体感` 行、采样点是否 ≥2。
- **`mm:ss` 标签含冒号**：正常，`decorate` 不碰表格内容里的冒号，只有分隔行 `|---|` 被识别为表格分隔。
- **渲染不参与评分**：`render_html.mjs` 不读 `roles/`、`evidence/`，不改任何文件，纯展示层。
