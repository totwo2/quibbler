#!/usr/bin/env node
/**
 * render_html.mjs —— report.md → 报纸版 report.html（P1，`--html` 开关）
 *
 * 职责：纯行解析 markdown 子集 → HTML，内联 assets/report-newspaper.css，
 *       情绪曲线三行表格 → SVG <polyline>，证据标签与双指标徽章着色。
 *
 * 契约：
 *   - stdout：唯一一个 JSON 对象 {html_path, bytes, sections, curves}
 *   - stderr：诊断信息
 *   - 退出码：0 成功 / 1 输入不合格 / 2 运行错误
 *
 * 零 npm 依赖、零正则回溯陷阱。不做任何语义判断，只做格式转换。
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSS_PATH = path.resolve(HERE, '..', 'assets', 'report-newspaper.css');

/** 情绪曲线表格的固定行标（report-template.md §4.5，三行表格）。 */
const CURVE_HEAD = '时刻';
const CURVE_SCORE = '体感';
const CURVE_VOICE = '心声';

/** 证据标签着色映射。 */
const EVIDENCE_TAGS = [
  ['🟢', 'ev-green'],
  ['🟡', 'ev-yellow'],
  ['🔴', 'ev-red'],
  ['🛡', 'ev-shield'],
];

/** 徽章着色：真实执行率低 = 灰色警示，尽责率低 = 红色告警。 */
const BADGES = [
  ['❌ 低于 85% 门槛', 'badge badge-danger'],
  ['✅ 可执行范围内已尽责', 'badge badge-ok'],
  ['— 本次无可执行范围', 'badge badge-mute'],
  ['⚠️ 环境受限', 'badge badge-warn'],
  ['✅ 无环境限制', 'badge badge-ok'],
];

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 行内标记：代码 → 链接 → 粗体 → 斜体。输入必须已转义。 */
function inline(text) {
  let s = text;
  s = s.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => `<a href="${href}">${label}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  return s;
}

/** 证据标签与徽章上色。对代码块内容同样生效（指标块本身就是代码块）。 */
function decorate(html) {
  let s = html;
  for (const [text, cls] of BADGES) {
    s = s.split(text).join(`<span class="${cls}">${text}</span>`);
  }
  for (const [emoji, cls] of EVIDENCE_TAGS) {
    s = s.split(emoji).join(`<span class="ev ${cls}">${emoji}</span>`);
  }
  return s;
}

/** 三行情绪曲线表 → SVG 折线。返回 null 表示这不是情绪曲线表。 */
function curveToSvg(header, rows) {
  if (!header || header[0] !== CURVE_HEAD) return null;
  const scoreRow = rows.find((r) => r[0] === CURVE_SCORE);
  const voiceRow = rows.find((r) => r[0] === CURVE_VOICE);
  if (!scoreRow) return null;

  const labels = header.slice(1);
  const scores = scoreRow.slice(1).map((v) => {
    const n = Number(String(v).trim());
    return Number.isFinite(n) ? Math.min(10, Math.max(0, n)) : 0;
  });
  const voices = voiceRow ? voiceRow.slice(1) : [];
  const n = Math.min(labels.length, scores.length);
  if (n < 2) return null;

  const W = 720;
  const H = 220;
  const padL = 40;
  const padR = 20;
  const padT = 20;
  const padB = 46;
  const stepX = (W - padL - padR) / (n - 1);
  const yOf = (score) => padT + (H - padT - padB) * (1 - score / 10);
  const pts = [];
  for (let i = 0; i < n; i += 1) pts.push(`${(padL + stepX * i).toFixed(1)},${yOf(scores[i]).toFixed(1)}`);

  const grid = [0, 5, 10]
    .map((g) => {
      const y = yOf(g).toFixed(1);
      return `<line class="grid" x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" />` +
        `<text class="axis" x="${padL - 8}" y="${(Number(y) + 4).toFixed(1)}" text-anchor="end">${g}</text>`;
    })
    .join('');

  const dots = [];
  for (let i = 0; i < n; i += 1) {
    const x = (padL + stepX * i).toFixed(1);
    const y = yOf(scores[i]).toFixed(1);
    const title = escapeHtml(`${labels[i]} · ${scores[i]} 分${voices[i] ? ` · ${voices[i]}` : ''}`);
    dots.push(
      `<circle class="dot" cx="${x}" cy="${y}" r="4"><title>${title}</title></circle>` +
        `<text class="score" x="${x}" y="${(Number(y) - 10).toFixed(1)}" text-anchor="middle">${scores[i]}</text>` +
        `<text class="tick" x="${x}" y="${H - padB + 18}" text-anchor="middle">${escapeHtml(labels[i])}</text>`,
    );
  }

  return (
    `<figure class="curve">` +
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="情绪曲线">` +
    `${grid}<polyline class="line" points="${pts.join(' ')}" />${dots.join('')}` +
    `</svg><figcaption>情绪曲线（0–10 分，悬停看心声）</figcaption></figure>`
  );
}

/** 拆表格行；非表格行返回 null。 */
function cellsOf(line) {
  const t = line.trim();
  if (!t.startsWith('|')) return null;
  const cells = t.split('|').map((c) => c.trim());
  cells.shift();
  if (cells.length > 0 && cells[cells.length - 1] === '') cells.pop();
  return cells;
}

const isSeparatorRow = (line) => /^\|[\s:|-]+\|?\s*$/.test(line.trim()) && line.includes('-');

/** markdown 子集 → HTML 主体。 */
function render(md, stats) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0;
  let listOpen = false;
  const closeList = () => {
    if (listOpen) {
      out.push('</ul>');
      listOpen = false;
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // 围栏代码块
    if (trimmed.startsWith('```')) {
      closeList();
      const buf = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1;
      out.push(`<pre class="block"><code>${decorate(escapeHtml(buf.join('\n')))}</code></pre>`);
      continue;
    }

    // HTML 注释（机器标记）—— 原样保留，渲染不可见
    if (trimmed.startsWith('<!--') && trimmed.endsWith('-->')) {
      closeList();
      out.push(trimmed);
      i += 1;
      continue;
    }

    // 表格
    const head = cellsOf(line);
    if (head && i + 1 < lines.length && isSeparatorRow(lines[i + 1])) {
      closeList();
      const body = [];
      i += 2;
      while (i < lines.length && cellsOf(lines[i]) && !isSeparatorRow(lines[i])) {
        body.push(cellsOf(lines[i]));
        i += 1;
      }
      const svg = curveToSvg(head, body);
      if (svg) {
        stats.curves += 1;
        out.push(svg);
        continue;
      }
      const th = head.map((c) => `<th>${decorate(inline(escapeHtml(c)))}</th>`).join('');
      const tr = body
        .map((r) => `<tr>${r.map((c) => `<td>${decorate(inline(escapeHtml(c)))}</td>`).join('')}</tr>`)
        .join('');
      out.push(`<div class="table-wrap"><table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`);
      continue;
    }

    // 标题
    const h = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (h) {
      closeList();
      const level = h[1].length;
      if (level === 2) {
        stats.sections += 1;
        if (stats.sections > 1) out.push('</section>');
        out.push('<section class="page">');
      }
      out.push(`<h${level}>${decorate(inline(escapeHtml(h[2])))}</h${level}>`);
      i += 1;
      continue;
    }

    // 引用块（连续行合并）
    if (trimmed.startsWith('>')) {
      closeList();
      const buf = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        buf.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      out.push(`<blockquote>${decorate(inline(escapeHtml(buf.join('\n')))).replace(/\n/g, '<br/>')}</blockquote>`);
      continue;
    }

    // 分隔线
    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      closeList();
      out.push('<hr/>');
      i += 1;
      continue;
    }

    // 无序列表
    const li = /^[-*]\s+(.*)$/.exec(trimmed);
    if (li) {
      if (!listOpen) {
        out.push('<ul>');
        listOpen = true;
      }
      out.push(`<li>${decorate(inline(escapeHtml(li[1])))}</li>`);
      i += 1;
      continue;
    }

    // 空行 / 段落
    if (trimmed === '') {
      closeList();
      i += 1;
      continue;
    }
    closeList();
    out.push(`<p>${decorate(inline(escapeHtml(trimmed)))}</p>`);
    i += 1;
  }
  closeList();
  if (stats.sections > 0) out.push('</section>');
  return out.join('\n');
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
    process.stderr.write(
      [
        '',
        'render_html.mjs —— report.md → 报纸版 report.html',
        '',
        '用法：node scripts/render_html.mjs "<workspace 或 report.md 路径>" [--out <file>] [--title <标题>]',
        '',
        '退出码：0 成功 / 1 输入不合格 / 2 运行错误',
        '',
      ].join('\n'),
    );
    return argv.length === 0 ? 1 : 0;
  }

  const input = path.resolve(argv[0]);
  const outIdx = argv.indexOf('--out');
  const titleIdx = argv.indexOf('--title');
  let reportPath = input;
  try {
    if (fs.statSync(input).isDirectory()) reportPath = path.join(input, 'report.md');
  } catch {
    process.stderr.write(`[html] 输入路径不存在：${input}\n`);
    return 1;
  }
  if (!fs.existsSync(reportPath)) {
    process.stderr.write(`[html] 找不到 report.md：${reportPath}\n`);
    return 1;
  }

  const md = fs.readFileSync(reportPath, 'utf8');
  const stats = { sections: 0, curves: 0 };
  const body = render(md, stats);

  let css = '';
  try {
    css = fs.readFileSync(CSS_PATH, 'utf8');
  } catch {
    process.stderr.write(`[html] 警告：未找到样式表 ${CSS_PATH}，将输出无样式 HTML。\n`);
  }

  const title = titleIdx >= 0 && argv[titleIdx + 1] ? argv[titleIdx + 1] : '《唱唱反调》THE QUIBBLER';
  const html = [
    '<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head>',
    '<meta charset="utf-8"/>',
    '<meta name="viewport" content="width=device-width,initial-scale=1"/>',
    `<title>${escapeHtml(title)}</title>`,
    `<style>\n${css}\n</style>`,
    '</head>',
    '<body>',
    '<main class="paper">',
    body,
    '</main>',
    '</body>',
    '</html>',
    '',
  ].join('\n');

  const outPath = outIdx >= 0 && argv[outIdx + 1] ? path.resolve(argv[outIdx + 1]) : path.join(path.dirname(reportPath), 'report.html');
  fs.writeFileSync(outPath, html, 'utf8');

  process.stdout.write(
    `${JSON.stringify({
      schema_version: '1.0',
      html_path: outPath.split(path.sep).join('/'),
      bytes: Buffer.byteLength(html, 'utf8'),
      sections: stats.sections,
      curves: stats.curves,
      css_inlined: css.length > 0,
    })}\n`,
  );
  process.stderr.write(`[html] 已生成：${outPath}（${stats.sections} 个版面 / ${stats.curves} 条情绪曲线）\n`);
  return 0;
}

try {
  process.exitCode = main();
} catch (err) {
  process.stderr.write(`[html] 运行错误：${err && err.stack ? err.stack : String(err)}\n`);
  process.exitCode = 2;
}
