#!/usr/bin/env node
/**
 * inspect_material.mjs —— 《唱唱反调》素材元信息采集器
 *
 * 职责：把「能被数出来的事」数清楚 —— 字节数、文件数、行数、字数、时长、扩展名分布、
 *       入口标记文件是否存在、URL 是否可达。
 *
 * ⚠️ 边界铁律：本脚本 **不判定素材类型**。
 *    `types` 恒为空数组，只输出 `type_signals`（客观事实信号）。
 *    类型判定权归主 Agent（见 references/material-typing.md）。
 *    本文件中不允许出现任何形如 `if (looksLikeCode)` 的语义分支。
 *
 * 契约：
 *   - stdout：唯一一个 MaterialProfile JSON 对象
 *   - stderr：所有诊断信息
 *   - 退出码：0 = 采集成功；1 = 素材不可访问（业务不合格）；2 = 运行错误
 *
 * 零 npm 依赖，仅用 node: 内置模块。Node 22 ESM。
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const SCHEMA_VERSION = '1.0';

/** 遍历时不下钻的目录名（体积大且非用户原创）。仍会对其中的标记文件做定点存在性检查。 */
const NO_DESCEND_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', '.venv', 'venv', 'env',
  '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache',
  'target', 'vendor', 'Pods', '.gradle', '.terraform',
  '.next', '.nuxt', '.svelte-kit', '.turbo', '.parcel-cache', '.cache',
  'coverage', '.nyc_output', '.idea', '.vscode', '.workbuddy', '.codebuddy',
]);

/** 会被逐行统计的文本类扩展名。 */
const TEXT_EXTS = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts',
  '.py', '.pyi', '.go', '.rs', '.java', '.kt', '.rb', '.php', '.pl',
  '.c', '.h', '.cc', '.cpp', '.hpp', '.cs', '.swift', '.m', '.mm', '.scala',
  '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd',
  '.sql', '.graphql', '.proto', '.lua', '.r', '.jl', '.dart', '.vue', '.svelte',
  '.html', '.htm', '.css', '.scss', '.sass', '.less', '.styl',
  '.json', '.jsonc', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env', '.properties',
  '.md', '.mdx', '.markdown', '.txt', '.rst', '.org', '.tex', '.adoc',
  '.csv', '.tsv', '.xml', '.svg', '.srt', '.vtt', '.ass', '.lrc', '.gitignore',
]);

/** 媒体扩展名（时长由 ffprobe 采集，缺 ffprobe 则留空）。 */
const MEDIA_EXTS = new Set([
  '.mp4', '.mov', '.mkv', '.avi', '.webm', '.flv', '.m4v', '.wmv', '.mpg', '.mpeg', '.ts',
  '.mp3', '.wav', '.aac', '.flac', '.m4a', '.ogg', '.opus', '.wma',
]);

/** 图像 / 设计稿扩展名。 */
const IMAGE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.tiff', '.avif',
  '.fig', '.sketch', '.psd', '.ai', '.xd',
]);

/** 二进制文档扩展名（需 markitdown-skill 转换，本脚本只统计不解析）。 */
const BINDOC_EXTS = new Set(['.docx', '.doc', '.pdf', '.pptx', '.ppt', '.xlsx', '.xls', '.epub', '.mobi', '.rtf', '.odt']);

/** 定点存在性检查的标记路径（相对素材根）。纯查表，命中即作为 type_signal 上报。 */
const MARKER_PATHS = [
  'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb',
  'pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile', 'poetry.lock',
  'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle', 'build.gradle.kts',
  'composer.json', 'Gemfile', 'mix.exs', 'CMakeLists.txt', 'Makefile',
  'Dockerfile', 'docker-compose.yml', 'docker-compose.yaml',
  '.git', '.env', '.env.example', '.gitignore',
  'tsconfig.json', 'vite.config.ts', 'vite.config.js', 'next.config.js', 'nuxt.config.ts',
  'webpack.config.js', 'rollup.config.js', 'astro.config.mjs', 'angular.json',
  'index.html', 'dist/index.html', 'build/index.html', 'public/index.html', 'out/index.html',
  'openapi.yaml', 'openapi.json', 'swagger.yaml', 'swagger.json',
  'api/openapi.yaml', 'docs/openapi.yaml', 'postman_collection.json',
  'README.md', 'README.txt', 'readme.md', 'README', 'CHANGELOG.md', 'LICENSE',
  'SKILL.md', 'manifest.json', 'CLAUDE.md', 'AGENTS.md',
];

/** 单文件读取上限（字节）。超过则只计字节数，不逐行统计。 */
const MAX_READ_BYTES = 4 * 1024 * 1024;

/** 目录遍历的文件数上限，超过则置 truncated。 */
const MAX_FILES = 30000;

/** URL 抓取上限（字节）与超时（毫秒）。 */
const MAX_FETCH_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 10000;

/** 体量分档阈值。纯数值规则，与 references/material-typing.md 的分档表一一对应。 */
const TIER_RULES = [
  { metric: 'lines', label: '行', s: 2000, m: 50000 },
  { metric: 'words', label: '字', s: 3000, m: 80000 },
  { metric: 'duration_s', label: '秒', s: 180, m: 1800 },
  { metric: 'bytes', label: '字节', s: 102400, m: 20971520 },
];

const TIER_ORDER = { S: 0, M: 1, L: 2 };

/**
 * 把任意输入判为 url / dir / file / missing。纯形态判断，不涉及素材语义。
 * @param {string} source
 * @returns {{kind: string, resolved: string, blocker: string|null}}
 */
function resolveSource(source) {
  if (/^https?:\/\//i.test(source)) {
    return { kind: 'url', resolved: source, blocker: null };
  }
  const resolved = path.resolve(source);
  try {
    const st = fs.statSync(resolved);
    if (st.isDirectory()) return { kind: 'dir', resolved, blocker: null };
    if (st.isFile()) return { kind: 'file', resolved, blocker: null };
    return { kind: 'other', resolved, blocker: '既不是文件也不是目录' };
  } catch (err) {
    return { kind: 'missing', resolved, blocker: `${err.code || 'ERR'}: 无法访问 ${resolved}` };
  }
}

/**
 * 统计一段文本的行数与字数。
 * 字数 = 拉丁词元数 + CJK 字符数（中文按字计，符合中文语境直觉）。
 * @param {string} text
 * @returns {{lines: number, words: number}}
 */
function countText(text) {
  if (text.length === 0) return { lines: 0, words: 0 };
  let lines = 1;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) lines += 1;
  }
  const cjk = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  const latin = (text.match(/[A-Za-z0-9_'-]+/g) || []).length;
  return { lines, words: cjk + latin };
}

/**
 * 读取一个文本文件并统计。失败返回零值，不抛。
 * @param {string} filePath
 * @param {number} size
 */
function statTextFile(filePath, size) {
  if (size > MAX_READ_BYTES) return { lines: 0, words: 0, read: false };
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    return { ...countText(text), read: true };
  } catch {
    return { lines: 0, words: 0, read: false };
  }
}

/**
 * 用 ffprobe 读媒体时长。ffprobe 不存在则返回 null（由主 Agent 走 forced_red_scopes）。
 * @param {string} filePath
 * @returns {number|null}
 */
function probeDuration(filePath) {
  try {
    const res = spawnSync(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
      { encoding: 'utf8', timeout: 15000, windowsHide: true },
    );
    if (res.error || res.status !== 0) return null;
    const value = Number.parseFloat(String(res.stdout || '').trim());
    return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  } catch {
    return null;
  }
}

/**
 * 递归遍历目录，累计统计量。
 * @param {string} rootDir
 * @returns {object}
 */
function walkDir(rootDir) {
  const acc = {
    bytes: 0,
    files: 0,
    dirs: 0,
    lines: 0,
    words: 0,
    ext_histogram: {},
    media_files: [],
    image_files: 0,
    bindoc_files: 0,
    unreadable: 0,
    truncated: false,
    skipped_dirs: [],
    max_depth: 0,
  };
  /** @type {{dir: string, depth: number}[]} */
  const queue = [{ dir: rootDir, depth: 0 }];

  while (queue.length > 0) {
    const { dir, depth } = queue.shift();
    if (acc.files >= MAX_FILES) {
      acc.truncated = true;
      break;
    }
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      acc.unreadable += 1;
      continue;
    }
    acc.max_depth = Math.max(acc.max_depth, depth);
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        acc.dirs += 1;
        if (NO_DESCEND_DIRS.has(entry.name)) {
          const rel = path.relative(rootDir, full).split(path.sep).join('/');
          if (!acc.skipped_dirs.includes(rel)) acc.skipped_dirs.push(rel);
          continue;
        }
        queue.push({ dir: full, depth: depth + 1 });
        continue;
      }
      if (!entry.isFile()) continue;
      if (acc.files >= MAX_FILES) {
        acc.truncated = true;
        break;
      }
      let size = 0;
      try {
        size = fs.statSync(full).size;
      } catch {
        acc.unreadable += 1;
        continue;
      }
      acc.files += 1;
      acc.bytes += size;
      const ext = path.extname(entry.name).toLowerCase() || '(noext)';
      acc.ext_histogram[ext] = (acc.ext_histogram[ext] || 0) + 1;

      if (TEXT_EXTS.has(ext)) {
        const counted = statTextFile(full, size);
        acc.lines += counted.lines;
        acc.words += counted.words;
      } else if (MEDIA_EXTS.has(ext)) {
        if (acc.media_files.length < 50) {
          acc.media_files.push(path.relative(rootDir, full).split(path.sep).join('/'));
        }
      } else if (IMAGE_EXTS.has(ext)) {
        acc.image_files += 1;
      } else if (BINDOC_EXTS.has(ext)) {
        acc.bindoc_files += 1;
      }
    }
  }
  return acc;
}

/**
 * 定点检查标记文件是否存在，并从 package.json 里抽出 scripts 键名。
 * 纯存在性检查 + 键名读取，不做任何「这是什么项目」的推断。
 * @param {string} rootDir
 */
function collectMarkers(rootDir) {
  const hits = [];
  const entrypoints = [];
  for (const rel of MARKER_PATHS) {
    const full = path.join(rootDir, ...rel.split('/'));
    try {
      fs.statSync(full);
      hits.push(rel);
    } catch {
      continue;
    }
  }
  if (hits.includes('package.json')) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
      for (const name of Object.keys(pkg.scripts || {})) {
        entrypoints.push(`package.json:scripts.${name}`);
      }
      if (pkg.main) entrypoints.push(`package.json:main=${pkg.main}`);
      if (pkg.bin) entrypoints.push('package.json:bin');
    } catch {
      entrypoints.push('package.json:(解析失败)');
    }
  }
  for (const rel of hits) {
    if (rel !== 'package.json' && !entrypoints.includes(rel)) entrypoints.push(rel);
  }
  return { hits, entrypoints };
}

/**
 * 抓取 URL 并统计客观信号（状态码、内容类型、字节数、标签计数）。
 * 只记事实，不推断这是不是「一个 Web 应用」。
 */
async function inspectUrl(url) {
  const signals = [];
  const out = {
    bytes: 0, lines: 0, words: 0, status: null, content_type: null,
    final_url: url, title: null, access_ok: false, access_blocker: null, signals,
  };
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'user-agent': 'quibbler-inspect/1.0' },
    });
    out.status = res.status;
    out.final_url = res.url || url;
    out.content_type = res.headers.get('content-type');
    signals.push(`http:status=${res.status}`);
    if (out.content_type) signals.push(`http:content-type=${out.content_type.split(';')[0].trim()}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const body = buf.subarray(0, MAX_FETCH_BYTES).toString('utf8');
    out.bytes = buf.length;
    const counted = countText(body);
    out.lines = counted.lines;
    out.words = counted.words;
    const titleMatch = body.match(/<title[^>]*>([\s\S]{0,200}?)<\/title>/i);
    if (titleMatch) out.title = titleMatch[1].trim();
    const tagCounts = {
      form: (body.match(/<form\b/gi) || []).length,
      video: (body.match(/<video\b/gi) || []).length,
      img: (body.match(/<img\b/gi) || []).length,
      script: (body.match(/<script\b/gi) || []).length,
      input: (body.match(/<input\b/gi) || []).length,
      canvas: (body.match(/<canvas\b/gi) || []).length,
    };
    for (const [tag, n] of Object.entries(tagCounts)) {
      if (n > 0) signals.push(`html:<${tag}>×${n}`);
    }
    out.access_ok = res.status < 400;
    if (!out.access_ok) out.access_blocker = `HTTP ${res.status}`;
  } catch (err) {
    out.access_blocker = `抓取失败：${err && err.message ? err.message : String(err)}`;
  }
  return out;
}

/**
 * 按数值阈值给出体量档建议（S/M/L）。取所有可用指标中的最高档。
 * @param {{lines:number, words:number, duration_s:number|null, bytes:number}} m
 */
function suggestTier(m) {
  let tier = 'S';
  const reasons = [];
  for (const rule of TIER_RULES) {
    const value = m[rule.metric];
    if (value === null || value === undefined || value <= 0) continue;
    let local = 'S';
    if (value > rule.m) local = 'L';
    else if (value > rule.s) local = 'M';
    reasons.push(`${value.toLocaleString('en-US')} ${rule.label}→${local}`);
    if (TIER_ORDER[local] > TIER_ORDER[tier]) tier = local;
  }
  return {
    size_tier: tier,
    tier_reason: reasons.length > 0 ? `${reasons.join('，')}；取最高档 ${tier}` : '无可用度量指标，默认 S 档',
  };
}

function printHelp() {
  process.stderr.write(
    [
      '',
      'inspect_material.mjs —— 《唱唱反调》素材元信息采集器',
      '',
      '用法：',
      '  node scripts/inspect_material.mjs "<路径或 URL>" [选项]',
      '',
      '选项：',
      '  --no-fetch    URL 输入时不真实抓取，只回填 source_kind（离线用）',
      '  --pretty      美化 JSON 输出',
      '  --help, -h    显示本帮助',
      '',
      '示例：',
      '  node scripts/inspect_material.mjs "D:/work/my repo"',
      '  node scripts/inspect_material.mjs "./demo.mp4"',
      '  node scripts/inspect_material.mjs "https://example.com" --pretty',
      '',
      '注意：本脚本只输出信号（type_signals），types 恒为空数组，类型判定由主 Agent 完成。',
      '退出码：0 成功 / 1 素材不可访问 / 2 运行错误',
      '',
    ].join('\n'),
  );
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return argv.length === 0 ? 2 : 0;
  }
  const pretty = argv.includes('--pretty');
  const noFetch = argv.includes('--no-fetch');
  const source = argv.find((a) => !a.startsWith('--'));
  if (!source) {
    printHelp();
    return 2;
  }

  const { kind, resolved, blocker } = resolveSource(source);
  process.stderr.write(`[inspect] source_kind=${kind} → ${resolved}\n`);

  const profile = {
    schema_version: SCHEMA_VERSION,
    inspected_at: new Date().toISOString(),
    source: resolved,
    source_name: kind === 'url' ? resolved : path.basename(resolved),
    source_kind: kind,
    types: [],
    type_signals: [],
    size_tier: 'S',
    tier_reason: '',
    bytes: 0,
    files: 0,
    dirs: 0,
    lines: 0,
    words: 0,
    duration_s: null,
    entrypoints: [],
    ext_histogram: {},
    media_files: [],
    image_files: 0,
    bindoc_files: 0,
    skipped_dirs: [],
    truncated: false,
    access_ok: false,
    access_blocker: blocker,
    notes: ['types 由主 Agent 依据 references/material-typing.md 判定；本脚本不做语义判断'],
  };

  if (kind === 'missing' || kind === 'other') {
    process.stdout.write(`${JSON.stringify(profile, null, pretty ? 2 : 0)}\n`);
    return 1;
  }

  if (kind === 'url') {
    if (noFetch) {
      profile.access_ok = false;
      profile.access_blocker = '已指定 --no-fetch，未做真实抓取';
      profile.type_signals = ['input:url'];
    } else {
      const u = await inspectUrl(resolved);
      profile.bytes = u.bytes;
      profile.lines = u.lines;
      profile.words = u.words;
      profile.access_ok = u.access_ok;
      profile.access_blocker = u.access_blocker;
      profile.type_signals = ['input:url', ...u.signals];
      profile.entrypoints = [u.final_url];
      profile.url_title = u.title;
      profile.url_status = u.status;
      profile.url_content_type = u.content_type;
    }
  } else if (kind === 'file') {
    const size = fs.statSync(resolved).size;
    const ext = path.extname(resolved).toLowerCase() || '(noext)';
    profile.bytes = size;
    profile.files = 1;
    profile.ext_histogram = { [ext]: 1 };
    profile.entrypoints = [path.basename(resolved)];
    profile.access_ok = true;
    const signals = ['input:file', `ext:${ext}`, `bytes:${size}`];
    if (TEXT_EXTS.has(ext)) {
      const counted = statTextFile(resolved, size);
      profile.lines = counted.lines;
      profile.words = counted.words;
      if (!counted.read) signals.push('read:skipped-too-large');
    } else if (MEDIA_EXTS.has(ext)) {
      profile.media_files = [path.basename(resolved)];
      profile.duration_s = probeDuration(resolved);
      signals.push(profile.duration_s === null ? 'ffprobe:unavailable-or-failed' : `duration_s:${profile.duration_s}`);
    } else if (IMAGE_EXTS.has(ext)) {
      profile.image_files = 1;
    } else if (BINDOC_EXTS.has(ext)) {
      profile.bindoc_files = 1;
      signals.push('binary-doc:需 markitdown-skill 转换后才能逐字读');
    }
    profile.type_signals = signals;
  } else {
    const acc = walkDir(resolved);
    const { hits, entrypoints } = collectMarkers(resolved);
    profile.bytes = acc.bytes;
    profile.files = acc.files;
    profile.dirs = acc.dirs;
    profile.lines = acc.lines;
    profile.words = acc.words;
    profile.ext_histogram = Object.fromEntries(
      Object.entries(acc.ext_histogram).sort((a, b) => b[1] - a[1]).slice(0, 30),
    );
    profile.media_files = acc.media_files;
    profile.image_files = acc.image_files;
    profile.bindoc_files = acc.bindoc_files;
    profile.skipped_dirs = acc.skipped_dirs;
    profile.truncated = acc.truncated;
    profile.entrypoints = entrypoints.slice(0, 40);
    profile.access_ok = true;
    if (acc.files === 0) {
      profile.access_ok = false;
      profile.access_blocker = '目录为空或全部子项不可读';
    }
    if (acc.media_files.length === 1) {
      profile.duration_s = probeDuration(path.join(resolved, ...acc.media_files[0].split('/')));
    }
    const signals = ['input:dir', ...hits];
    const topExts = Object.entries(profile.ext_histogram).slice(0, 8);
    for (const [ext, n] of topExts) signals.push(`ext:${ext}×${n}`);
    if (acc.media_files.length > 0) signals.push(`media-files:${acc.media_files.length}`);
    if (acc.image_files > 0) signals.push(`image-files:${acc.image_files}`);
    if (acc.bindoc_files > 0) signals.push(`binary-doc-files:${acc.bindoc_files}`);
    if (acc.truncated) signals.push(`truncated:文件数超过 ${MAX_FILES}，统计不完整`);
    profile.type_signals = signals;
  }

  const tier = suggestTier({
    lines: profile.lines,
    words: profile.words,
    duration_s: profile.duration_s,
    bytes: profile.bytes,
  });
  profile.size_tier = tier.size_tier;
  profile.tier_reason = tier.tier_reason;

  process.stdout.write(`${JSON.stringify(profile, null, pretty ? 2 : 0)}\n`);
  process.stderr.write(
    `[inspect] files=${profile.files} lines=${profile.lines} words=${profile.words} tier=${profile.size_tier}\n`,
  );
  return profile.access_ok ? 0 : 1;
}

/** 用 exitCode 而非 process.exit()，避免 Windows 管道下 stdout 被截断。 */
main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    process.stderr.write(`[inspect] 运行错误：${err && err.stack ? err.stack : String(err)}\n`);
    process.exitCode = 2;
  });
