#!/usr/bin/env node
/**
 * verify_report.mjs —— 《唱唱反调》报告体检器（可信度的最后一道闸）
 *
 * 职责（全部确定性机器校验，不含任何语义判断）：
 *   1. ARTIFACT_DANGLING —— green 证据声明的 artifact 是否真实存在于磁盘（**最重要**）
 *   2. ARTIFACT_REQUIRED —— 凡 level=green 一律须声明真实存在的 artifact（与 type 无关，HI-2）
 *   3. RED_IN_P0 / P0_MIXED_SIGNAL —— 《分类广告栏》FIXLIST 区内 P0 行必须显式携带 🟢（白名单 + 黑名单；🟢🔴 并存报混合信号）
 *   4. REASONING_NOT_RED —— type=reasoning 只能 level=red 且 artifact=null（推演铁律，HI-1）
 *   5. 双指标计算        —— real_exec_rate（对用户）/ diligence_rate（对技能）；尽责率虚高 >30pp 报 DILIGENCE_RATE_INFLATED，带证据绿亮点 >8 报 HIGHLIGHT_OVERFLOW
 *   6. 凭据泄漏扫描      —— 凭据串走 stdin，绝不走 argv（argv 会在进程列表里泄漏）
 *   7. 锚点完整性        —— report-template.md §1 的 1 报头 + 9 版面 H2 锚点
 *   8. 占位符残留        —— 未回填的 {{XXX}}
 *   9. 角色数与席位配额  —— 5–7 人（lite 3），敌对席 / 边缘用户席各 ≥1
 *  10. 指标回填          —— --write-back 把机器值写回 report.md 报头
 *  附：evidence/INDEX.md 生成、孤儿证据、谎报借口交叉核对（FALSE_ENV_EXCUSE /
 *     FALSE_ACCESS_EXCUSE / ENV_REASON_UNSTRUCTURED / UNKNOWN_TOOL）、CASTING_MISMATCH 告警
 *
 * 契约：
 *   - stdout：唯一一个 JSON 对象（ReportMetrics）
 *   - stderr：人类可读摘要
 *   - 退出码：0 = 通过；1 = 有违规；2 = 运行错误
 *     （与 SKILL.md §3 阶段 5、init_workspace.mjs、system_design.md §2.4 的既定语义一致）
 *
 * 设计纪律：脚本里**不允许**出现 `if (roleId === 'A3')` 这类语义分支。
 * 一切「这条该不该算」的判断都由数据字段（cause / seat / level）驱动，判断归模型，算术归脚本。
 *
 * 零 npm 依赖，仅用 node: 内置模块。Node ≥18 ESM。用 PATH 上的 node，不写死版本路径。
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const SCHEMA_VERSION = '1.0';

/** 报头锚点（report-template.md §1 #0），单独校验，不计入 9 版面。 */
const MASTHEAD_ANCHOR = '## 📰 刊号栏';

/** 9 个版面 H2 锚点，逐字固定，顺序不可换。 */
const SECTION_ANCHORS = [
  '## 🗞 头版头条',
  '## ⚰️ 讣告版 · 致命伤',
  '## 📢 社论 · 众口一词',
  '## ⚔️ 争鸣版 · 唱唱反调',
  '## ✉️ 读者来信',
  '## 💎 遗珠版 · 被低估的亮点',
  '## 🌡 天气预报 · 风险预测',
  '## 📋 分类广告栏 · 急聘修复',
  '## ⚖️ 更正与声明',
];

/** 机器标记注释（report-template.md §3），成对出现且独占一行。 */
const MARKER_PAIRS = ['QUIBBLER:METRICS', 'QUIBBLER:CASTING', 'QUIBBLER:FIXLIST'];

/**
 * 历史白名单：green 时 artifact 必填且文件须存在的证据类型。
 * 已退役（HI-2）：现在「凡 level=green 一律需真实存在的 artifact，与 type 无关」。
 * 仅留作常量，便于将来对 yellow 也要求 artifact 时复用（目前 yellow 不强制）。
 */
const ARTIFACT_REQUIRED_TYPES = new Set(['command', 'browser', 'frame']);

/** 可从尽责率分母扣除的 cause（dxp-protocol §5.2.1）。budget_exhausted 恒不可扣。 */
const EXCUSABLE_CAUSES = new Set(['env_missing', 'access_denied', 'not_applicable']);

/** 结构化 tool 字段别名 → EnvProbe.available 的 key（子代理可能写 browser/chrome）。 */
const TOOL_ALIASES = { browser: 'agent_browser', chrome: 'agent_browser' };

/** 席位枚举中必须各占 ≥1 的两个硬席位（SKILL.md §3 阶段 2）。 */
const REQUIRED_SEATS = ['adversary', 'edge_user'];

/** 尽责率硬验收门槛。 */
const DILIGENCE_THRESHOLD_DEFAULT = 0.85;

/** 凭据形态通用规则。value 组一律脱敏后输出，绝不回显原文。 */
const CREDENTIAL_PATTERNS = [
  { name: 'password', re: /\b(?:password|passwd|pwd)\s*[=:]\s*(\S{3,})/gi },
  { name: 'token', re: /\btoken\s*[=:]\s*([A-Za-z0-9_\-.]{6,})/gi },
  { name: 'bearer', re: /\bBearer\s+([A-Za-z0-9_\-.=]{12,})/g },
  { name: 'api_key', re: /\bapi[_-]?key\s*[=:]\s*([A-Za-z0-9_\-]{6,})/gi },
  { name: 'secret', re: /\b(?:secret|client_secret)\s*[=:]\s*(\S{6,})/gi },
  { name: 'private_key', re: /(-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----)/g },
  { name: 'aws_akid', re: /\b(AKIA[0-9A-Z]{16})\b/g },
  { name: 'github_pat', re: /\b(gh[pousr]_[A-Za-z0-9]{20,})\b/g },
  // Y11：Slack token 形如 xoxb- / xoxp- / xoxa- / xoxs- / xoxr-，即使被 <...> 外壳包住，
  // 直接匹配 token 本身也能命中（token= 模式因 < 不在值字符类里而捕获不到）。
  { name: 'slack_token', re: /\b(xox[baprs]-[A-Za-z0-9_-]{8,})\b/g },
];

/** 二进制/大文件跳过全文扫描。 */
const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.pdf', '.mp4', '.mov',
  '.webm', '.mp3', '.wav', '.zip', '.gz', '.tar', '.7z', '.woff', '.woff2', '.ttf', '.otf',
]);
const SCAN_MAX_BYTES = 2 * 1024 * 1024;

/**
 * 已脱敏的值不算泄漏。纯掩码符、全串锚定（左右都有边界），杜绝「以 x 开头真密码」
 * 或前缀匹配被误判为已脱敏。字母 x 一律不准进字符类。
 */
const MASKED_RE = /^[*•·]{3,}$/;

/**
 * 模板占位符（整串须为占位形态，内部字符集白名单，**不允许嵌套外壳**）：
 *   <...>  /  {{...}}  /  ${...}  /  [UPPER_CASE]
 * 内部只允许 [A-Za-z0-9_\- .]（字母数字下划线横线空格点），出现 `{`/`}`/`<`/`>`/`$`
 * 等外壳字符即不算占位符——Y10 的 `{{a{{RealSecret9x}}`（内层又出现 `{{`）不再豁免。
 * 例：<your-token-here>、{{PLACEHOLDER}}、${VAR}、[REDACTED] 放行；
 *     {abc123realpassword（不闭合）、{{a{{RealSecret9x}} 仍被扫描。
 */
const PLACEHOLDER_RE = /^(<[A-Za-z0-9_\- .]+>|\{\{[A-Za-z0-9_\- .]+\}\}|\$\{[A-Za-z0-9_\- .]+\}|\[[A-Za-z0-9_\- .]+\])$/;

/** 剥掉占位符外壳，返回内部内容；非占位形态返回 null。 */
function placeholderInner(value) {
  const v = String(value);
  if (/^\{\{[\s\S]*\}\}$/.test(v)) return v.slice(2, -2);
  if (/^\$\{[\s\S]*\}$/.test(v)) return v.slice(2, -1);
  if (/^<[\s\S]*>$/.test(v)) return v.slice(1, -1);
  if (/^\[[\s\S]*\]$/.test(v)) return v.slice(1, -1);
  return null;
}

/**
 * 一条候选值是否算「已脱敏 / 占位符」而豁免（Y10/Y11）：
 * 占位符外壳内不得藏真实凭据形态——剥壳后内部再跑一遍全部凭据正则，
 * 内部命中（如 <AKIA...>、<xoxb-...>）→ 不豁免，按 CREDENTIAL_LEAK 报。
 */
function isExemptValue(value) {
  if (MASKED_RE.test(value)) return true;
  if (!PLACEHOLDER_RE.test(value)) return false;
  const inner = placeholderInner(value);
  if (inner == null) return false;
  // 必须用「去 g 的克隆」而非共享的 CREDENTIAL_PATTERNS 原对象：
  // 原对象带 g 标志，exec 会推进 lastIndex；这里若直接复用并重设 lastIndex，
  // 会破坏 scanText 外层 while 的推进状态，导致对占位符值死循环（X12ok_mustache 实测卡死）。
  for (const { re } of CREDENTIAL_PATTERNS) {
    const innerRe = new RegExp(re.source, re.flags.replace('g', ''));
    const mm = innerRe.exec(inner);
    if (mm && mm[1] && !MASKED_RE.test(mm[1]) && !PLACEHOLDER_RE.test(mm[1])) return false;
  }
  return true;
}

/**
 * P0 行证据格的绿标白名单（M-2）。P0 只接受实测级，必须显式自证为绿。
 *
 * 【务必保留 \u{...} 转义 + u 标志】直接把 🟢 写进正则字符类是错的：
 * 无 u 标志时 JS 会把星光平面字符拆成两个代理码元放进类里，
 * 例如 [🔴🟥] 实际等价于 [\uD83D\uDD34\uD83E\uDFE5]，
 * 而 🟢 = U+1F7E2 = \uD83E\uDFE2，其高位代理 \uD83E 正好命中该类，
 * 导致「绿标被判成红标」的假阳性。使用交替 + u 标志可彻底规避。
 */
const P0_GREEN_RE = /\u{1F7E2}|green|绿/iu;

/** P0 行的推演级黑名单兜底：🔴 / 🟥 / red / 红 / 推演 / 未实测 / 未验证。 */
const P0_RED_RE = /\u{1F534}|\u{1F7E5}|红|推演|未实测|未验证|\bred\b/iu;

/**
 * P0 绿标收紧版（Y6/Y7）：
 *  - 只认 emoji 🟢，或独立词元 green/绿（前后非词字符或行边界）；
 *  - 词元附近 6 字符窗口出现否定词（无/未/没有/不/not/no/none）→ 不命中，
 *    避免「无 green 证据，未达绿标」这类否定句被子串匹配误判为绿。
 * 调用方命中绿后仍须再跑 P0_RED_RE：🟢 与 🔴 并存 → P0_MIXED_SIGNAL。
 */
function p0GreenTokenRe(token) {
  // 必须带 g：p0EvidenceIsGreen 里用 while (mm = re.exec(s)) 推进，无 g 会永远命中第一个匹配 → 死循环。
  return new RegExp(`(^|[^A-Za-z0-9_\\u4e00-\\u9fff])${token}([^A-Za-z0-9_\\u4e00-\\u9fff]|$)`, 'gi');
}
const P0_NEGATION_RE = /(无|未|没有|不|not|no|none)/i;
function p0EvidenceIsGreen(cell) {
  const s = String(cell);
  if (/\u{1F7E2}/u.test(s)) return true; // 🟢 显式实测标记
  for (const token of ['green', '绿']) {
    const re = p0GreenTokenRe(token);
    re.lastIndex = 0;
    let mm = re.exec(s);
    while (mm) {
      const start = Math.max(0, mm.index - 6);
      const end = Math.min(s.length, mm.index + mm[0].length + 6);
      if (!P0_NEGATION_RE.test(s.slice(start, end))) return true;
      mm = re.exec(s);
    }
  }
  return false;
}

// ────────────────────────────────────────────────────────────── 通用工具

/** 解析 `--key value` / `--flag`。 */
function parseArgs(argv) {
  const out = { _: [], flags: new Set() };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      out._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out.flags.add(key);
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

/**
 * 锚点归一化（report-template.md §1 匹配规则）：
 * 删除变体选择符 U+FE0F → 折叠空白 → trim。**全等比较，不用 includes。**
 */
function normalizeAnchor(line) {
  return String(line).replace(/\uFE0F/g, '').replace(/\s+/g, ' ').trim();
}

/** POSIX 风格相对路径。 */
function toPosix(p) {
  return String(p).split(path.sep).join('/');
}

/** 本地时区 ISO 8601。 */
function isoLocal(d = new Date()) {
  const pad = (n, w = 2) => String(Math.abs(n)).padStart(w, '0');
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
  );
}

/** 递归列出目录下全部文件（相对 root 的 posix 路径）。 */
function walkFiles(root, rel = '', acc = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const child = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walkFiles(root, child, acc);
    else if (e.isFile()) acc.push(child);
  }
  return acc;
}

/** 同步读 stdin；无管道输入时安全返回空串。 */
function readStdinSync() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/** 从 markdown 中抽出所有 fenced json 块，返回能 JSON.parse 且带 schema_version 的那些。 */
function extractJsonBlocks(text) {
  const out = [];
  const re = /```(?:json|jsonc)?\s*\n([\s\S]*?)\n```/g;
  let m = re.exec(text);
  while (m) {
    try {
      const obj = JSON.parse(m[1]);
      if (obj && typeof obj === 'object' && obj.schema_version) out.push(obj);
    } catch {
      /* 非 JSON 代码块，跳过 */
    }
    m = re.exec(text);
  }
  return out;
}

// ────────────────────────────────────────────────────────────── 日志解析

/**
 * 载入 roles/ 下的 ExperienceLog。
 * `.json` 整份解析；`.md` 抽取内嵌的 fenced json 块（人读版日志内嵌原始 JSON）。
 */
function loadLogs(workspace, problems) {
  const rolesDir = path.join(workspace, 'roles');
  const logs = [];
  let names = [];
  try {
    names = fs.readdirSync(rolesDir).sort();
  } catch {
    return logs;
  }
  for (const name of names) {
    const abs = path.join(rolesDir, name);
    let stat;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    const ext = path.extname(name).toLowerCase();
    let raw = '';
    try {
      raw = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    if (ext === '.json') {
      try {
        const obj = JSON.parse(raw);
        logs.push({ file: `roles/${name}`, log: obj });
      } catch (err) {
        problems.push({ code: 'PARSE_FAIL', where: `roles/${name}`, detail: `JSON 解析失败：${err.message}` });
      }
    } else if (ext === '.md') {
      const blocks = extractJsonBlocks(raw);
      if (blocks.length > 0) logs.push({ file: `roles/${name}`, log: blocks[0] });
    }
  }
  return logs;
}

/** 递归收集全部 EvidenceRef（用于 artifact 存在性核对）。 */
function collectEvidence(node, out, trail) {
  if (Array.isArray(node)) {
    node.forEach((v, i) => collectEvidence(v, out, `${trail}[${i}]`));
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const [k, v] of Object.entries(node)) {
    const at = trail ? `${trail}.${k}` : k;
    if (k === 'evidence' && v && typeof v === 'object' && !Array.isArray(v)) {
      out.push({ at, ref: v });
      continue;
    }
    collectEvidence(v, out, at);
  }
}

/**
 * 结算一条证据的**实际**等级：自称实测但拿不出可核验产物的，一律按推演级 red 计。
 *
 * 为什么必须「降级为 red」而不是「排除出计数域」——两者差别很大：
 *   排除 → green 和 total 一起减，1 真绿 + 1 假绿 算出来还是 1/1 = 100%，照样虚高；
 *   降级 → green 减、total 不变，1 真绿 + 1 假绿 = 1/2 = 50%，这才是诚实值。
 * 只报违规不改算术等于半修：报告照样能印出漂亮的执行率。
 *
 * 两类降级：
 *   1. type=reasoning 却标绿/黄（HI-1 铁律，违规码 REASONING_NOT_RED）；
 *   2. level=green 但 artifact 缺失或磁盘上不存在（HI-2 / ARTIFACT_DANGLING）。
 * 注意：artifact 真实存在、只是漏登记进 evidence_files 的，**不降级**——
 * 产物本身可核验，那只是台账问题，仍由 ARTIFACT_DANGLING 单独报。
 *
 * @param {object} ev 证据对象
 * @param {Set<object>=} unproven refs 循环里判定为「拿不出产物」的证据对象集合（按引用比对）
 * @returns {{level: string, downgraded: boolean}}
 */
function settleLevel(ev, unproven) {
  const evType = String(ev.type || '').toLowerCase();
  const lv = normalizeLevel(ev.level);
  if (evType === 'reasoning' && lv !== 'red') return { level: 'red', downgraded: true };
  if (lv === 'green' && unproven && unproven.has(ev)) return { level: 'red', downgraded: true };
  return { level: lv, downgraded: false };
}

/**
 * 计数域（dxp-protocol §5.0，唯一口径，不可扩大也不可缩小）：
 * step4_friction_log[] + fatal_flaws[] + underrated_highlights[]（挂了 evidence 的）。
 * step2/step3 是「动作」，计入覆盖度，**不计入执行率**。
 */
function countingDomain(log, missingEvidence, roleId, unproven) {
  const items = [];
  let highlightGreen = 0;
  const push = (arr, label, requireEvidence) => {
    if (!Array.isArray(arr)) return;
    arr.forEach((it, i) => {
      const ev = it && typeof it === 'object' ? it.evidence : null;
      if (ev && typeof ev === 'object') {
        const { level: lv, downgraded } = settleLevel(ev, unproven);
        items.push({ at: `${label}[${i}]`, level: lv, downgraded });
        // Y27：只统计「带证据且结算为绿」的亮点条数，用于 HIGHLIGHT_OVERFLOW 上限。
        if (label === 'step6_verdict.underrated_highlights' && lv === 'green') highlightGreen += 1;
      } else if (requireEvidence) {
        missingEvidence.push(`${roleId}:${label}[${i}]`);
      }
    });
  };
  push(log.step4_friction_log, 'step4_friction_log', true);
  const verdict = log.step6_verdict && typeof log.step6_verdict === 'object' ? log.step6_verdict : {};
  push(verdict.fatal_flaws, 'step6_verdict.fatal_flaws', true);
  push(verdict.underrated_highlights, 'step6_verdict.underrated_highlights', false);
  return { items, highlightGreen };
}

/**
 * 覆盖度分子：step2 + step3 中 level ∈ {green, yellow} 的动作条数（dxp §5.3）。
 *
 * 走 settleLevel 而非裸 toLowerCase()，为的是全文件对「绿」只保留一套定义：
 *   - 归一化：level 写成 "绿" / "GREEN" 也能正确计入（原先裸比对会漏计，覆盖度偏低 →
 *     CASTING_MISMATCH 假阳性 → 主 Agent 误以为要补角色）；
 *   - 降级：自称实测却拿不出产物的动作不算「做过」，否则覆盖度和执行率一样会被撑高。
 */
function countActionsDone(log, unproven) {
  let done = 0;
  for (const key of ['step2_main_path', 'step3_edge_attempts']) {
    const arr = log[key];
    if (!Array.isArray(arr)) continue;
    for (const it of arr) {
      const ev = it && typeof it === 'object' ? it.evidence : null;
      if (!ev || typeof ev !== 'object') continue;
      const { level: lv } = settleLevel(ev, unproven);
      if (lv === 'green' || lv === 'yellow') done += 1;
    }
  }
  return done;
}

/** 工具名词边界匹配（避免 "node" 命中 "node-gyp"）。 */
function mentionsTool(text, tool) {
  const esc = tool.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9_-])${esc}([^A-Za-z0-9_-]|$)`, 'i').test(text);
}

/** 证据等级归一化：英文 / 大写 / 中文 三种写法都认可（green=绿、yellow=黄、red=红）。 */
function normalizeLevel(l) {
  const s = String(l || '').toLowerCase();
  if (s === 'green' || s === '绿') return 'green';
  if (s === 'yellow' || s === '黄') return 'yellow';
  if (s === 'red' || s === '红') return 'red';
  return s;
}

// ────────────────────────────────────────────────────────────── 报告解析

/** 切出 BEGIN/END 标记之间的行（含行号，1 起）。 */
function sliceMarker(lines, marker) {
  const begin = lines.findIndex((l) => l.trim() === `<!-- ${marker}:BEGIN -->`);
  const end = lines.findIndex((l) => l.trim() === `<!-- ${marker}:END -->`);
  if (begin < 0 || end < 0 || end < begin) return null;
  return { begin, end, lines: lines.slice(begin + 1, end).map((text, i) => ({ text, lineNo: begin + 2 + i })) };
}

/** 拆一行 markdown 表格为单元格数组。 */
function tableCells(line) {
  const t = line.trim();
  if (!t.startsWith('|')) return null;
  const cells = t.split('|').map((c) => c.trim());
  cells.shift();
  if (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
  return cells;
}

// ────────────────────────────────────────────────────────────── 凭据扫描

/** 扫单个文本，返回命中列表（**只记位置与脱敏预览，绝不回显原文**）。 */
function scanText(relPath, text, secrets) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, idx) => {
    for (const secret of secrets) {
      if (line.includes(secret)) {
        hits.push({ file: relPath, line: idx + 1, kind: 'user_secret', preview: `<len:${secret.length}>` });
      }
    }
    for (const { name, re } of CREDENTIAL_PATTERNS) {
      re.lastIndex = 0;
      let m = re.exec(line);
      while (m) {
        const value = m[1] || '';
        if (!isExemptValue(value)) {
          hits.push({ file: relPath, line: idx + 1, kind: name, preview: `${value.slice(0, 2)}***<len:${value.length}>` });
        }
        m = re.exec(line);
      }
    }
  });
  return hits;
}

// ────────────────────────────────────────────────────────────── 指标渲染

function pct(n) {
  return `${Math.round(n * 100)}%`;
}

/** 机器回填位取值（report-template.md §2.1）。 */
function buildFills(m, meta) {
  const envMissing = m.env_missing.length > 0 ? m.env_missing.join(' / ') : '无';
  const hints = m.install_hints.length > 0 ? m.install_hints.join('\n            → ') : '—';
  const diligenceRate =
    m.diligence_rate === null ? '不适用' : `${pct(m.diligence_rate)}（${m.green}/${m.diligence_denominator}）`;
  const diligenceBadge =
    m.diligence_rate === null
      ? '— 本次无可执行范围'
      : m.diligence_rate >= m.diligence_threshold
        ? '✅ 可执行范围内已尽责'
        : '❌ 低于 85% 门槛';
  return {
    REAL_EXEC_RATE: `${pct(m.real_exec_rate)}（${m.green}/${m.total_conclusions}）`,
    REAL_EXEC_BADGE: m.excusable_red > 0 ? '⚠️ 环境受限' : '✅ 无环境限制',
    DILIGENCE_RATE: diligenceRate,
    DILIGENCE_BADGE: diligenceBadge,
    GREEN_COUNT: String(m.green),
    YELLOW_COUNT: String(m.yellow),
    RED_COUNT: String(m.red),
    EXCUSABLE_RED: String(m.excusable_red),
    TOTAL_CONCLUSIONS: String(m.total_conclusions),
    ENV_MISSING: envMissing,
    INSTALL_HINTS: hints,
    AFFECTED_ROLES: m.affected_roles.length > 0 ? m.affected_roles.join('、') : '无',
    COVERAGE: m.coverage,
    ISSUE_NO: String(meta && meta.issue_no ? meta.issue_no : 1).padStart(3, '0'),
    VERIFY_STATUS: m.violations.length === 0 ? '通过' : `未通过（${m.violations.length} 项待修）`,
    VERIFY_TIME: isoLocal(),
  };
}

// ────────────────────────────────────────────────────────────── 主流程

function printHelp() {
  process.stderr.write(
    [
      '',
      'verify_report.mjs —— 《唱唱反调》报告体检（可信度最后一道闸）',
      '',
      '用法：',
      '  node scripts/verify_report.mjs "<workspace>" [选项]',
      '  printf "%s\\n" "$PASSWORD" | node scripts/verify_report.mjs "<ws>" --secrets-from-stdin',
      '',
      '选项：',
      '  --secrets-from-stdin      从 stdin 逐行读取凭据串做全文扫描（**绝不走 argv**）',
      '  --write-back              把机器指标回填进 report.md 的 {{占位符}}',
      '  --env-probe <file>        EnvProbe JSON 文件；缺省读 meta.json.env_probe',
      '  --diligence-threshold <n> 尽责率门槛，默认 0.85',
      '  --soft-diligence          LOW_DILIGENCE 降为告警，不影响退出码',
      '  --no-index                不生成 evidence/INDEX.md',
      '  --pretty                  美化 stdout JSON',
      '  --help, -h                显示本帮助',
      '',
      '退出码：0 通过 / 1 有违规 / 2 运行错误',
      '',
    ].join('\n'),
  );
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return 0;
  }
  const args = parseArgs(argv);
  const workspace = path.resolve(args._[0] || args.workspace || process.cwd());
  const threshold = Number.isFinite(Number(args['diligence-threshold']))
    ? Number(args['diligence-threshold'])
    : DILIGENCE_THRESHOLD_DEFAULT;

  if (!fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) {
    process.stderr.write(`[verify] 报告目录不存在：${workspace}\n`);
    return 2;
  }

  /** @type {Array<{code:string, where:string, detail:string}>} */
  const violations = [];
  /** @type {Array<{code:string, where:string, detail:string}>} */
  const warnings = [];
  const addV = (code, where, detail) => violations.push({ code, where, detail });
  const addW = (code, where, detail) => warnings.push({ code, where, detail });

  // ── meta.json / EnvProbe
  let meta = null;
  try {
    meta = JSON.parse(fs.readFileSync(path.join(workspace, 'meta.json'), 'utf8'));
  } catch {
    addW('META_UNREADABLE', 'meta.json', 'meta.json 缺失或不可解析，期号/模式/EnvProbe 交叉核对将跳过');
  }
  let envProbe = meta && meta.env_probe ? meta.env_probe : null;
  if (args['env-probe']) {
    try {
      envProbe = JSON.parse(fs.readFileSync(path.resolve(args['env-probe']), 'utf8'));
    } catch (err) {
      process.stderr.write(`[verify] --env-probe 读取失败：${err.message}\n`);
      return 2;
    }
  }
  const availableTools = new Set(
    envProbe && Array.isArray(envProbe.available)
      ? envProbe.available.map((s) => String(s).toLowerCase())
      : envProbe && envProbe.capabilities
        ? Object.entries(envProbe.capabilities).filter(([, v]) => v === true).map(([k]) => k.toLowerCase())
        : [],
  );
  // Y2：env_probe.missing 里的 key 才算「真缺失」，tool 既不在 available 也不在 missing → 编造工具名。
  const missingTools = new Set(
    envProbe && Array.isArray(envProbe.missing)
      ? envProbe.missing.map((s) => String(s).toLowerCase())
      : [],
  );
  if (!envProbe) addW('ENVPROBE_UNKNOWN', 'meta.json.env_probe', 'EnvProbe 不可得，FALSE_ENV_EXCUSE 交叉核对已跳过');
  const accessStatus = meta && meta.access_status ? String(meta.access_status) : null;
  if (!accessStatus) {
    addW('ACCESS_STATUS_UNKNOWN', 'meta.json.access_status', 'access_status 未记录，FALSE_ACCESS_EXCUSE 交叉核对已跳过');
  }

  // ── report.md
  const reportPath = path.join(workspace, 'report.md');
  if (!fs.existsSync(reportPath)) {
    addV('REPORT_MISSING', 'report.md', '报告主文件不存在，无法体检');
    const empty = emptyMetrics(threshold, violations, warnings);
    emit(empty, args, workspace);
    return 1;
  }
  let report;
  try {
    report = fs.readFileSync(reportPath, 'utf8');
  } catch (err) {
    addV('REPORT_UNREADABLE', 'report.md', `report.md 读取失败（${err.code || '错误'}：${err.message}），无法体检`);
    const empty = emptyMetrics(threshold, violations, warnings);
    emit(empty, args, workspace);
    return 2;
  }
  let reportLines = report.split(/\r?\n/);

  // ── 检查 5：锚点完整性
  const presentAnchors = new Set(
    reportLines.filter((l) => l.trimStart().startsWith('## ')).map((l) => normalizeAnchor(l)),
  );
  const mastheadPresent = presentAnchors.has(normalizeAnchor(MASTHEAD_ANCHOR));
  const sectionsMissing = SECTION_ANCHORS.filter((a) => !presentAnchors.has(normalizeAnchor(a)));
  if (!mastheadPresent) addV('SECTION_MISSING', 'report.md', `报头锚点缺失：${MASTHEAD_ANCHOR}`);
  for (const a of sectionsMissing) addV('SECTION_MISSING', 'report.md', `版面锚点缺失：${a}`);

  // ── 机器标记
  const markerRegions = {};
  for (const marker of MARKER_PAIRS) {
    const region = sliceMarker(reportLines, marker);
    markerRegions[marker] = region;
    if (!region) addV('MARKER_MISSING', 'report.md', `机器标记不成对或缺失：<!-- ${marker}:BEGIN/END -->`);
  }

  // ── 载入 ExperienceLog
  const parseProblems = [];
  const entries = loadLogs(workspace, parseProblems);
  for (const p of parseProblems) addV(p.code, p.where, p.detail);
  if (entries.length === 0) {
    addV('NO_ROLE_LOGS', 'roles/', 'roles/ 下没有可解析的 ExperienceLog（.json 或内嵌 fenced json 的 .md），指标无法机器计算');
  }

  // ── 逐份日志：证据 / 计数域 / 降级原因
  let green = 0;
  let yellow = 0;
  let red = 0;
  let excusableRed = 0;
  let actionsDone = 0;
  let plannedActions = 0;
  let highlightGreenTotal = 0; // Y27：全报告带证据的绿色亮点总数（上限 8）
  const dangling = [];
  const referenced = new Set();
  const missingEvidence = [];
  const roleIds = [];
  const seats = [];
  const affectedRoles = [];
  const degradationOut = [];
  const naByAction = new Map();

  const castingIndex = new Map();
  if (meta && Array.isArray(meta.casting)) {
    for (const c of meta.casting) {
      if (c && c.role_id) castingIndex.set(String(c.role_id), c);
    }
  }

  for (const { file, log } of entries) {
    const roleId = String(log.role_id || path.basename(file, path.extname(file)));
    roleIds.push(roleId);
    if (log.seat) seats.push(String(log.seat));

    // 检查 1：ARTIFACT_DANGLING
    const refs = [];
    collectEvidence(log, refs, '');
    const declared = new Set(Array.isArray(log.evidence_files) ? log.evidence_files.map(String) : []);
    // 「自称绿但拿不出可核验产物」的证据对象（按引用登记），交给 settleLevel 降级为 red，
    // 确保 real_exec_rate / diligence_rate / coverage 三个指标都不被虚高的绿撑起来。
    const unproven = new Set();
    for (const { at, ref } of refs) {
      const level = normalizeLevel(ref.level);
      const type = String(ref.type || '').toLowerCase();
      const artifact = ref.artifact == null ? '' : String(ref.artifact).trim();
      if (artifact) referenced.add(toPosix(artifact));

      // ── HI-1：推演类铁律（subagent-return-schema §3.2 铁律 2）──
      // type=reasoning 只能 level=red，且 artifact 必须为 null（推演不产生证据文件）。
      if (type === 'reasoning') {
        if (level !== 'red') {
          addV(
            'REASONING_NOT_RED',
            `${roleId}:${at}`,
            `推演类证据（type=reasoning）只能是 🔴 推演级；当前 level=${ref.level || '(空)'}。实测/半实测须给出可核验产物（改 type=command/file/search 并挂真实 artifact）`,
          );
        }
        if (artifact) {
          addV(
            'REASONING_NOT_RED',
            `${roleId}:${at}`,
            `推演类证据（type=reasoning）禁止携带 artifact；当前 artifact=${artifact}。推演不产生证据文件，实测产物才允许挂`,
          );
        }
        continue; // reasoning 不参与 artifact 存在性核对
      }

      // ── HI-2：凡 level=green 一律需真实存在的 artifact，与 type 无关 ──
      // 绿 = 实测，实测必留痕。原 ARTIFACT_REQUIRED_TYPES 白名单已退役。
      if (level === 'green') {
        if (!artifact) {
          addV(
            'ARTIFACT_REQUIRED',
            `${roleId}:${at}`,
            `level=green（实测）但 artifact 为空：实测级结论必须挂真实存在的产物，与 type 无关`,
          );
          unproven.add(ref);
          continue;
        }
        const abs = path.resolve(workspace, artifact);
        if (!fs.existsSync(abs)) {
          dangling.push({ role_id: roleId, at, artifact, reason: '文件在磁盘上不存在' });
          unproven.add(ref); // 产物不存在 = 拿不出可核验证据，指标侧按 red 结算
        } else if (declared.size > 0 && !declared.has(artifact)) {
          // 产物真实存在，只是漏登记进 evidence_files —— 台账问题，可核验性不受影响，不降级
          dangling.push({ role_id: roleId, at, artifact, reason: 'artifact 不在 evidence_files 列表内' });
        }
      }
    }

    // 计数域
    const { items: domain, highlightGreen } = countingDomain(log, missingEvidence, roleId, unproven);
    highlightGreenTotal += highlightGreen;
    let roleRed = 0;
    let roleRedDeclared = 0; // 作者自己写成 red 的条数（不含被降级的），用于 RED_NO_REASON
    for (const item of domain) {
      if (item.level === 'green') green += 1;
      else if (item.level === 'yellow') yellow += 1;
      else if (item.level === 'red') {
        red += 1;
        roleRed += 1;
        if (!item.downgraded) roleRedDeclared += 1;
      } else {
        addV('COUNT_MISMATCH', `${roleId}:${item.at}`, `evidence.level 非法值：${JSON.stringify(item.level)}`);
      }
    }
    if (domain.length > 0 && domain.every((d) => d.level === 'red')) affectedRoles.push(roleId);

    // 覆盖度
    actionsDone += countActionsDone(log, unproven);
    const casting = castingIndex.get(roleId);
    const planned = casting && Number.isFinite(Number(casting.planned_actions)) ? Number(casting.planned_actions) : 0;
    plannedActions += planned;

    // 降级原因 → excusable_red（含两条反滥用交叉核对）
    let roleExcusable = 0;
    let roleNa = 0;
    const reasons = Array.isArray(log.degradation_reasons) ? log.degradation_reasons : [];
    for (const r of reasons) {
      if (!r || typeof r !== 'object') continue;
      let cause = String(r.cause || '').toLowerCase();
      const text = `${r.what || ''} ${r.why || ''}`;
      let reclassified = false;

      if (cause === 'env_missing') {
        const rawTool = r.tool;
        const toolIsString = typeof rawTool === 'string';
        const rawToolStr = toolIsString ? String(rawTool).trim() : '';
        const tool = rawToolStr ? TOOL_ALIASES[rawToolStr.toLowerCase()] || rawToolStr.toLowerCase() : '';
        if (rawTool == null || (toolIsString && rawToolStr === '')) {
          // 结构化字段缺失（未填或空串）→ 违规（无法机检，仍按可免责红处理，但记一笔）
          addV(
            'ENV_REASON_UNSTRUCTURED',
            `${roleId}:degradation_reasons`,
            `cause=env_missing 但未填结构化 tool 字段（枚举对齐 EnvProbe key，如 git/ffmpeg/browser/network），无法机检，已按可免责红处理并记违规`,
          );
          // 兜底：文本 fuzzy 仍可能抓出撒谎
          if (availableTools.size > 0) {
            const hit = [...availableTools].find((t) => mentionsTool(text, t));
            if (hit) {
              addV('FALSE_ENV_EXCUSE', `${roleId}:degradation_reasons`, `声称缺失 ${hit}（仅文本提及，无 tool 字段），EnvProbe 显示可用 → 强制改判 budget_exhausted`);
              cause = 'budget_exhausted';
              reclassified = true;
            }
          }
        } else if (!toolIsString) {
          // Y4：tool 必须是字符串；数组/数字/对象 → 结构化字段不合法，无法机检
          addV(
            'ENV_REASON_UNSTRUCTURED',
            `${roleId}:degradation_reasons`,
            `cause=env_missing 的 tool 字段必须是字符串；当前为 ${Array.isArray(rawTool) ? '数组' : typeof rawTool}（${JSON.stringify(rawTool)}），无法机检`,
          );
        } else if (availableTools.has(tool)) {
          // 结构化硬比对：EnvProbe 显示该工具可用 → 谎报
          addV('FALSE_ENV_EXCUSE', `${roleId}:degradation_reasons`, `声称 ${tool} 不可用，但 EnvProbe 显示可用 → 强制改判 budget_exhausted`);
          cause = 'budget_exhausted';
          reclassified = true;
        } else if (!missingTools.has(tool)) {
          // Y2：tool 既不在 available 也不在 missing → 凭空捏造的工具名
          addV('UNKNOWN_TOOL', `${roleId}:degradation_reasons`, `cause=env_missing 的 tool=${rawToolStr} 不在 env_probe.missing（${[...missingTools].join('/') || '无'}）也不在 available，疑似编造工具名`);
        }
        // tool 填了且 EnvProbe 显示确实缺失 → 正常免责，不报
      }
      if (cause === 'access_denied' && accessStatus && accessStatus !== 'refused') {
        addV('FALSE_ACCESS_EXCUSE', `${roleId}:degradation_reasons`, `cause=access_denied 但 meta.json.access_status=${accessStatus} → 强制改判 budget_exhausted`);
        cause = 'budget_exhausted';
        reclassified = true;
      }
      if (!EXCUSABLE_CAUSES.has(cause) && cause !== 'budget_exhausted') {
        addV('RED_NO_REASON', `${roleId}:degradation_reasons`, `cause 缺失或越界：${JSON.stringify(r.cause)}`);
      }
      if (EXCUSABLE_CAUSES.has(cause)) roleExcusable += 1;
      if (cause === 'not_applicable') {
        roleNa += 1;
        const key = normalizeAnchor(r.what || '');
        if (key) {
          if (!naByAction.has(key)) naByAction.set(key, new Set());
          naByAction.get(key).add(roleId);
        }
      }
      degradationOut.push({
        role_id: roleId,
        what: r.what ?? null,
        why: r.why ?? null,
        cause,
        deductible: EXCUSABLE_CAUSES.has(cause),
        reclassified,
        how_user_can_verify: r.how_user_can_verify ?? null,
      });
    }
    // 只按「作者自己标成 red」的条数追问降级原因。被 settleLevel 降级的那些，
    // 作者本以为是绿，当然不会写降级原因——真正的问题已由
    // ARTIFACT_REQUIRED / ARTIFACT_DANGLING / REASONING_NOT_RED 报出，这里不叠加噪音。
    if (roleRedDeclared > 0 && reasons.length === 0) {
      addV('RED_NO_REASON', roleId, `存在 ${roleRedDeclared} 条 red 结论，但 degradation_reasons 为空`);
    }
    if (roleExcusable > roleRed) {
      addV('EXCUSABLE_RED_OVERFLOW', roleId, `可免责 red 数 ${roleExcusable} > 该角色 red 结论数 ${roleRed}，cause 标注或计数域有误（已按 ${roleRed} 封顶）`);
    }
    excusableRed += Math.min(roleExcusable, roleRed);

    // CASTING_MISMATCH（告警，不改退出码）—— 问责编排层，不是角色
    if (planned > 0 && roleNa >= planned / 3) {
      addW('CASTING_MISMATCH', roleId, `选角偏差：${roleNa}/${planned} 项动作对本素材不成立，编辑部选角判断失误`);
    } else if (planned === 0 && roleNa > 0) {
      addW('PLANNED_ACTIONS_UNKNOWN', roleId, 'meta.json.casting[].planned_actions 缺失，CASTING_MISMATCH 选角型判定已跳过');
    }
  }
  for (const [action, ids] of naByAction) {
    if (ids.size >= 2) {
      addW('CASTING_MISMATCH', [...ids].join(','), `判型偏差：动作「${action}」被 ${ids.size} 位体验者判定为不成立，素材类型标签可能贴错`);
    }
  }
  // Y27：带证据的绿色亮点上限 8（角色最多 7 人，每人至多 1 条合理），超出即灌水。
  if (highlightGreenTotal > 8) {
    addV('HIGHLIGHT_OVERFLOW', 'metrics', `带证据的绿色亮点共 ${highlightGreenTotal} 条，超过上限 8（角色最多 7 人，每人至多 1 条合理），疑似灌水刷分子`);
  }
  for (const at of missingEvidence) addV('EVIDENCE_MISSING', at, '计数域内条目缺 evidence 对象');
  for (const d of dangling) {
    addV('ARTIFACT_DANGLING', `${d.role_id}:${d.at}`, `${d.reason}${d.artifact ? `：${d.artifact}` : ''}`);
  }

  // ── 检查 7：角色数与席位配额
  const mode = meta && meta.mode ? String(meta.mode) : 'default';
  const expected = mode === 'lite' ? { min: 3, max: 3 } : { min: 5, max: 7 };
  const roleCount = new Set(roleIds).size;
  if (roleCount > 0 && (roleCount < expected.min || roleCount > expected.max)) {
    addV('ROLE_COUNT_BAD', 'roles/', `实际角色数 ${roleCount}，${mode} 模式要求 ${expected.min}–${expected.max}`);
  }
  if (roleCount > 0) {
    const seatSet = new Set(seats);
    for (const seat of REQUIRED_SEATS) {
      if (!seatSet.has(seat)) addV('SEAT_QUOTA_BAD', 'roles/', `硬席位缺失：${seat}（该席位至少 1 人）`);
    }
  }

  // ── 检查 2：RED_IN_P0（只扫 FIXLIST 标记区内）
  // 白名单 + 黑名单双保险：P0 行必须显式携带 🟢（实测级），否则一律违规；
  // 黑名单兜底捕捉任何推演级标记（🔴/🟥/red/推演/未实测/未验证）。
  const fixlist = markerRegions['QUIBBLER:FIXLIST'];
  if (fixlist) {
    for (const { text, lineNo } of fixlist.lines) {
      const cells = tableCells(text);
      if (!cells || cells.length < 4) continue;
      if (/^[-: |]+$/.test(text.trim())) continue;
      const pCell = cells[1] || '';
      if (!/P0/.test(pCell)) continue;
      const evidenceCell = cells[3] || '';
      const problem = (cells[2] || '').trim();

      // 白名单（收紧版）：显式携带 🟢 / 独立词元 green / 绿 即视为实测级；
      // 命中后仍须再跑黑名单 —— 🟢 与 🔴/推演 并存 → P0_MIXED_SIGNAL（Y6）。
      // 注意：这里必须用 \u{...} + u 标志，绝不能写成 [🔴🟥] 这类字符类 ——
      // 无 u 标志时 [🔴🟥] 会被降解成代理码元类 [\uD83D\uDD34\uD83E\uDFE5]，
      // 而 🟢(U+1F7E2 = \uD83E\uDFE2) 的高位代理 \uD83E 恰好落在类内，导致绿标被误判为红标。
      const isGreen = p0EvidenceIsGreen(evidenceCell);
      const isRed = P0_RED_RE.test(evidenceCell);
      if (isGreen && isRed) {
        addV('P0_MIXED_SIGNAL', `report.md:${lineNo}`, `P0 行证据格同时出现绿标与推演级标记（🟢 与 🔴/推演/未实测 并存），信号冲突：${problem}`);
        continue;
      }
      if (isGreen) continue;

      // 未能自证为绿：再用黑名单区分「明确推演级」与「无标记」，只为给出更准确的 detail。
      if (isRed) {
        addV('RED_IN_P0', `report.md:${lineNo}`, `P0 行证据格出现推演级标记（应为 🟢 实测）：${problem}`);
      } else {
        addV('RED_IN_P0', `report.md:${lineNo}`, `P0 行无 🟢 绿标证据（只接受实测级，yellow/空/红均不合规）：${problem}`);
      }
    }
  }

  // ── 检查 3：双指标
  const totalConclusions = green + yellow + red;
  const realExecRate = totalConclusions > 0 ? Number((green / totalConclusions).toFixed(2)) : 0;
  const diligenceDenom = totalConclusions - excusableRed;
  const diligenceRate = diligenceDenom > 0 ? Number((green / diligenceDenom).toFixed(2)) : null;

  // ── 孤儿证据
  const evidenceRoot = path.join(workspace, 'evidence');
  const evidenceFiles = fs.existsSync(evidenceRoot) ? walkFiles(evidenceRoot) : [];
  const orphan = evidenceFiles
    .map((f) => `evidence/${f}`)
    .filter((f) => f !== 'evidence/INDEX.md' && !referenced.has(f));
  if (orphan.length > 0) addW('ORPHAN_EVIDENCE', 'evidence/', `${orphan.length} 个证据文件未被任何结论引用`);

  // ── 检查 4：凭据泄漏扫描（凭据只从 stdin 来）
  let secrets = [];
  if (args.flags.has('secrets-from-stdin')) {
    secrets = readStdinSync()
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 4);
  }
  const leaks = [];
  for (const rel of walkFiles(workspace)) {
    if (BINARY_EXT.has(path.extname(rel).toLowerCase())) continue;
    const abs = path.join(workspace, rel);
    try {
      if (fs.statSync(abs).size > SCAN_MAX_BYTES) continue;
      leaks.push(...scanText(rel, fs.readFileSync(abs, 'utf8'), secrets));
    } catch {
      /* 不可读文件跳过 */
    }
  }
  const credentialLeak = leaks.length > 0;
  for (const l of leaks) {
    addV('CREDENTIAL_LEAK', `${l.file}:${l.line}`, `疑似凭据明文（${l.kind}，已脱敏：${l.preview}）`);
  }

  // ── 尽责率门槛
  const softDiligence = args.flags.has('soft-diligence');
  if (diligenceRate !== null && diligenceRate < threshold) {
    const detail = `尽责率 ${pct(diligenceRate)}（${green}/${diligenceDenom}）低于 ${pct(threshold)} 门槛。budget_exhausted 不可扣除，这指控的是技能本身。`;
    if (softDiligence) addW('LOW_DILIGENCE', 'metrics', detail);
    else addV('LOW_DILIGENCE', 'metrics', detail);
  }

  // ── 指标失真保护（Y26）：尽责率不该比真实执行率高出一大截。
  // 尽责率本质是「排除环境因素后的执行率」；高出 30 个百分点以上，只可能是
  // 分母被 excusable_red 结构性吃空（如 17 条 env_missing 全免责、只剩 1 条分母）。
  if (diligenceRate !== null && realExecRate >= 0 && diligenceRate > realExecRate + 0.3) {
    addV('DILIGENCE_RATE_INFLATED', 'metrics', `尽责率 ${pct(diligenceRate)}（${green}/${diligenceDenom}）比真实执行率 ${pct(realExecRate)}（${green}/${totalConclusions}）高 ${pct(diligenceRate - realExecRate)}（>30 个百分点）——分母疑似被可免责红结构性吃空`);
  }

  const metrics = {
    schema_version: SCHEMA_VERSION,
    workspace: toPosix(workspace),
    real_exec_rate: realExecRate,
    diligence_rate: diligenceRate,
    diligence_denominator: diligenceDenom,
    diligence_threshold: threshold,
    coverage: plannedActions > 0 ? `${actionsDone}/${plannedActions}` : `${actionsDone}/未记录`,
    green,
    yellow,
    red,
    excusable_red: excusableRed,
    total_conclusions: totalConclusions,
    env_missing: envProbe && Array.isArray(envProbe.missing) ? envProbe.missing : [],
    install_hints: envProbe && Array.isArray(envProbe.install_hints) ? envProbe.install_hints : [],
    affected_roles: affectedRoles,
    role_count: roleCount,
    role_ids: [...new Set(roleIds)],
    seats: [...new Set(seats)],
    masthead_present: mastheadPresent,
    sections_present: SECTION_ANCHORS.length - sectionsMissing.length,
    sections_missing: sectionsMissing,
    degradation_reasons: degradationOut,
    dangling_evidence: dangling,
    orphan_evidence: orphan,
    credential_leak: credentialLeak,
    credential_hits: leaks.map((l) => ({ file: l.file, line: l.line, kind: l.kind })),
    placeholders_left: [],
    warnings,
    violations,
    exit_code: 0,
  };

  // ── 检查 8：回填（必须在残留检查之前）
  if (args.flags.has('write-back')) {
    const fills = buildFills(metrics, meta);
    let next = report;
    for (const [key, value] of Object.entries(fills)) {
      next = next.split(`{{${key}}}`).join(value);
    }
    if (next !== report) {
      fs.writeFileSync(reportPath, next, 'utf8');
      report = next;
      reportLines = report.split(/\r?\n/);
    }
    metrics.written_back = Object.keys(fills);
  }

  // ── 检查 6：占位符残留
  const left = new Set();
  const phRe = /\{\{[A-Z0-9_]+\}\}/g;
  reportLines.forEach((line, i) => {
    let m = phRe.exec(line);
    while (m) {
      left.add(m[0]);
      addV('PLACEHOLDER_RESIDUAL', `report.md:${i + 1}`, `未回填的占位符：${m[0]}`);
      m = phRe.exec(line);
    }
  });
  metrics.placeholders_left = [...left];

  // ── evidence/INDEX.md
  if (!args.flags.has('no-index') && fs.existsSync(evidenceRoot)) {
    writeIndex(workspace, evidenceRoot, evidenceFiles, referenced);
    metrics.index_written = 'evidence/INDEX.md';
  }

  metrics.exit_code = violations.length > 0 ? 1 : 0;
  emit(metrics, args, workspace);
  return metrics.exit_code;
}

/** report.md 缺失时的空指标骨架。 */
function emptyMetrics(threshold, violations, warnings) {
  return {
    schema_version: SCHEMA_VERSION,
    real_exec_rate: 0,
    diligence_rate: null,
    diligence_threshold: threshold,
    green: 0, yellow: 0, red: 0, excusable_red: 0, total_conclusions: 0,
    sections_present: 0, sections_missing: SECTION_ANCHORS,
    dangling_evidence: [], orphan_evidence: [], credential_leak: false,
    warnings, violations, exit_code: 1,
  };
}

/** 生成 evidence/INDEX.md。 */
function writeIndex(workspace, evidenceRoot, files, referenced) {
  const rows = files
    .filter((f) => f !== 'INDEX.md')
    .sort()
    .map((f) => {
      let size = 0;
      try {
        size = fs.statSync(path.join(evidenceRoot, f)).size;
      } catch {
        size = 0;
      }
      const rel = `evidence/${f}`;
      const roleId = f.includes('/') ? f.slice(0, f.indexOf('/')) : '—';
      return `| ${roleId} | [${f}](${f}) | ${size.toLocaleString('en-US')} B | ${referenced.has(rel) ? '✅ 已引用' : '⚠️ 孤儿'} |`;
    });
  const body = [
    '# 证据索引',
    '',
    `> 由 \`scripts/verify_report.mjs\` 自动生成 · ${isoLocal()}`,
    '> 「孤儿」= 落盘了但没有任何结论引用它。不一定是错，但值得看一眼。',
    '',
    '| 角色 | 文件 | 大小 | 引用状态 |',
    '|---|---|---|---|',
    ...(rows.length > 0 ? rows : ['| — | （本期无证据文件） | — | — |']),
    '',
  ].join('\n');
  fs.writeFileSync(path.join(evidenceRoot, 'INDEX.md'), body, 'utf8');
}

/** stdout 出 JSON，stderr 出人读摘要。 */
function emit(m, args, workspace) {
  process.stdout.write(`${JSON.stringify(m, null, args.flags.has('pretty') ? 2 : 0)}\n`);
  const lines = [
    '',
    `[verify] 报告目录：${workspace}`,
    `[verify] 真实执行率：${pct(m.real_exec_rate || 0)}（${m.green}/${m.total_conclusions}）  ← 对用户，不设下限`,
    `[verify] 尽责率：    ${m.diligence_rate === null ? '不适用（本次无可执行范围）' : `${pct(m.diligence_rate)}（${m.green}/${m.diligence_denominator}）`}  ← 对技能，门槛 ${pct(m.diligence_threshold)}`,
    `[verify] 证据构成：🟢 ${m.green} · 🟡 ${m.yellow} · 🔴 ${m.red}（其中可免责 ${m.excusable_red}）`,
    `[verify] 版面：${m.sections_present}/9${m.masthead_present ? ' + 报头' : '（报头缺失）'}　凭据泄漏：${m.credential_leak ? '❗ 是' : '否'}　悬空证据：${(m.dangling_evidence || []).length}`,
  ];
  if ((m.warnings || []).length > 0) {
    lines.push(`[verify] 告警 ${m.warnings.length} 条（不阻断）：`);
    for (const w of m.warnings) lines.push(`         · ${w.code} @ ${w.where} —— ${w.detail}`);
  }
  if ((m.violations || []).length > 0) {
    lines.push(`[verify] ❌ 违规 ${m.violations.length} 条：`);
    for (const v of m.violations) lines.push(`         · ${v.code} @ ${v.where} —— ${v.detail}`);
    lines.push('[verify] 修完再跑一次。伪造证据整份作废，诚实降级不扣分。');
  } else {
    lines.push('[verify] ✅ 体检通过。');
  }
  process.stderr.write(`${lines.join('\n')}\n`);
}

/** 用 exitCode 而非 process.exit()，避免 Windows 管道下 stdout 被截断。 */
try {
  process.exitCode = main();
} catch (err) {
  process.stderr.write(`[verify] 运行错误：${err && err.stack ? err.stack : String(err)}\n`);
  process.exitCode = 2;
}
