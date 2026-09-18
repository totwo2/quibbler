#!/usr/bin/env node
/**
 * init_workspace.mjs —— 《唱唱反调》报告工作区初始化
 *
 * 职责：slug 化素材名 → 处理同日冲突 → 预建 evidence/{ROLE_ID}/ 与 roles/ → 写 meta.json
 *       → 检测 .gitignore 状况并输出提示（**绝不自动改用户的 .gitignore**）。
 *
 * 预建 evidence 子目录是「零搬运」设计的关键：子代理直接写约定路径，事后无需归档脚本。
 *
 * 契约：
 *   - stdout：唯一一个 JSON 对象
 *   - stderr：所有诊断信息
 *   - 退出码：0 = 成功；1 = 参数不合法（业务不合格）；2 = 运行错误
 *
 * 零 npm 依赖，仅用 node: 内置模块。Node 22 ESM。
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const SCHEMA_VERSION = '1.0';

/**
 * 报告根目录（相对 cwd）。
 * 2026-09-17 变更：原先把产物挂到宿主平台的数据目录下；改为 skill 自有目录 ——
 * 报告是 skill 的产物，落在用户项目里应当自解释，不依赖宿主平台叫什么。
 * 本变更取代「主理人决策 7」中关于目录位置的部分。（`--out` 仍可整目录覆盖。）
 */
const REPORT_ROOT_SEGMENTS = ['.quibbler', 'reports'];

/** 角色 id 白名单模式：1–2 位大写字母 + 1–2 位数字。临时角色可用 X1/X2。 */
const ROLE_ID_RE = /^[A-Z]{1,2}\d{1,2}$/;

/** slug 允许长度上限。 */
const SLUG_MAX = 40;

/**
 * slug 化：剔除 <>:"/\|?* 与控制字符，空格转 -，保留中文，截断 40，空则用 material。
 * @param {string} raw
 * @returns {string}
 */
function slugify(raw) {
  const stripped = String(raw ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"/\\|?*]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .trim();
  const cut = Array.from(stripped).slice(0, SLUG_MAX).join('');
  return cut.length > 0 ? cut : 'material';
}

/** 本地日期 YYYY-MM-DD。 */
function localDate(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 解析 `--key value` / `--flag` 形式的参数。
 * @param {string[]} argv
 */
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
    if (next === undefined || next.startsWith('--')) {
      out.flags.add(key);
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

/**
 * 向上查找 .git 目录，判断 cwd 是否在 git 仓库内。
 * @param {string} startDir
 * @returns {string|null} 仓库根目录
 */
function findGitRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let depth = 0; depth < 64; depth += 1) {
    try {
      if (fs.existsSync(path.join(dir, '.git'))) return dir;
    } catch {
      /* 继续向上 */
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * 检查仓库 .gitignore 是否已忽略产物目录。纯文本行匹配。
 * @param {string|null} gitRoot
 */
function checkGitignore(gitRoot) {
  if (!gitRoot) {
    return { in_git_repo: false, artifact_dir_ignored: false, hint: null };
  }
  const ignoreFile = path.join(gitRoot, '.gitignore');
  let ignored = false;
  try {
    const lines = fs.readFileSync(ignoreFile, 'utf8').split(/\r?\n/);
    ignored = lines.some((line) => {
      const t = line.trim().replace(/^\/+/, '').replace(/\/+$/, '');
      return t === '.quibbler' || t === '.quibbler/**' || t === '.quibbler/reports';
    });
  } catch {
    ignored = false;
  }
  return {
    in_git_repo: true,
    git_root: gitRoot,
    artifact_dir_ignored: ignored,
    hint: ignored
      ? null
      : `检测到 ${gitRoot} 是 git 仓库，且 .gitignore 未忽略 .quibbler/。建议手动追加一行 “.quibbler/”，否则体验证据（截图/日志）会被提交。本脚本不会替你改文件。`,
  };
}

function printHelp() {
  process.stderr.write(
    [
      '',
      'init_workspace.mjs —— 《唱唱反调》报告工作区初始化',
      '',
      '用法：',
      '  node scripts/init_workspace.mjs --name "<素材名>" --roles A3,B5,D6 [选项]',
      '',
      '选项：',
      '  --name <素材名>     必填（或用 --material 从路径推导）',
      '  --material <路径>   素材源，写入 meta.json；--name 缺省时用其 basename',
      '  --roles A3,B5,D6    角色 id 列表，逗号分隔，用于预建 evidence/{ID}/（保留不动）',
      '  --env-probe <路径>  preflight 落盘的 EnvProbe JSON，原样嵌进 meta.env_probe',
      '  --casting <路径>    选角 JSON 数组 [{role_id,seat,planned_actions,rationale}]，写进 meta.casting',
      '  --access-status <v> 访问状态 granted|refused|unknown，写进 meta.access_status',
      '  --types CODE,WEB    素材类型，写入 meta.json',
      '  --mode default|lite|full   本次运行模式，写入 meta.json',
      '  --cwd <目录>        工作目录基准，默认 process.cwd()',
      '  --out <目录>        直接指定报告根目录，覆盖 {cwd}/.quibbler/reports',
      '  --reuse             同日同素材目录已存在时复用它，而不是追加 -2',
      '  --pretty            美化 JSON 输出',
      '  --help, -h          显示本帮助',
      '',
      '示例：',
      '  node scripts/init_workspace.mjs --name "我的 项目" --roles A3,B5',
      '  node scripts/init_workspace.mjs --material "D:/work/my repo" --roles A3,A2,A6,D3,B5,E8 --types CODE,WEB',
      '',
      '退出码：0 成功 / 1 参数不合法 / 2 运行错误',
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
  const pretty = args.flags.has('pretty');
  const cwd = path.resolve(args.cwd || process.cwd());

  const rawName = args.name || (args.material ? path.basename(path.resolve(args.material)) : args._[0]);
  if (!rawName) {
    process.stderr.write('[init] 缺少 --name（或 --material）。\n');
    printHelp();
    return 1;
  }

  /** 角色 id 校验：只做格式白名单，不做「这个角色是谁」的语义判断。 */
  const roleTokens = String(args.roles || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const invalidRoles = roleTokens.filter((id) => !ROLE_ID_RE.test(id));
  if (invalidRoles.length > 0) {
    process.stderr.write(`[init] 非法角色 id：${invalidRoles.join(', ')}（应形如 A3 / B5 / D10 / X1）\n`);
    return 1;
  }
  const roles = [...new Set(roleTokens)];

  // ── 上游数据：env_probe（preflight 落盘）/ casting（阶段 2 产出）/ access_status ──
  // 全部可选：缺失时行为与旧版一致，verify 会退化为 UNKNOWN 告警而非硬失败（闸门没通电）。
  let envProbe = null;
  if (args['env-probe']) {
    try {
      envProbe = JSON.parse(fs.readFileSync(path.resolve(args['env-probe']), 'utf8'));
    } catch (err) {
      process.stderr.write(`[init] --env-probe 读取/解析失败：${err.message}\n`);
      return 2;
    }
  }

  /** 席位取值域（与 casting-rules.md 对齐；verify 仅强制 adversary/edge_user 非空）。 */
  const SEAT_SET = new Set(['adversary', 'edge_user', 'professional_core', 'layman', 'crossover']);

  let casting = null;
  if (args.casting) {
    try {
      casting = JSON.parse(fs.readFileSync(path.resolve(args.casting), 'utf8'));
      if (!Array.isArray(casting)) throw new Error('casting 必须是 JSON 数组');
    } catch (err) {
      process.stderr.write(`[init] --casting 读取/解析失败：${err.message}\n`);
      return 2;
    }
    for (const c of casting) {
      if (!c || typeof c.role_id !== 'string' || !ROLE_ID_RE.test(c.role_id)) {
        process.stderr.write(`[init] casting 元素 role_id 非法：${JSON.stringify(c)}\n`);
        return 1;
      }
      if (typeof c.seat !== 'string' || c.seat.trim() === '' || !SEAT_SET.has(c.seat)) {
        process.stderr.write(`[init] casting 元素 seat 非法（须为 ${[...SEAT_SET].join('/')}）：${JSON.stringify(c)}\n`);
        return 1;
      }
      if (typeof c.planned_actions !== 'number' || !Number.isFinite(c.planned_actions) || c.planned_actions < 0) {
        process.stderr.write(`[init] casting 元素 planned_actions 非法（须为 ≥0 数字）：${JSON.stringify(c)}\n`);
        return 1;
      }
    }
  }

  // casting 为准；若 --roles 也给了，两套 role_id 集合必须一致，否则主 Agent 拼错参数。
  const castRoleIds = casting ? casting.map((c) => c.role_id) : null;
  if (casting && roles.length > 0) {
    const a = new Set(roles);
    const b = new Set(castRoleIds);
    if (a.size !== b.size || [...a].some((x) => !b.has(x))) {
      process.stderr.write(`[init] --roles 与 --casting 的 role_id 集合不一致：${roles.join(',')} vs ${castRoleIds.join(',')}\n`);
      return 1;
    }
  }
  const effectiveRoles = casting ? castRoleIds : roles;
  if (effectiveRoles.length === 0) {
    process.stderr.write('[init] 警告：既无 --roles 也无 --casting，evidence/ 下不会预建角色子目录。\n');
  }

  const slug = slugify(rawName);
  const date = localDate();
  const reportRoot = args.out ? path.resolve(args.out) : path.join(cwd, ...REPORT_ROOT_SEGMENTS);
  fs.mkdirSync(reportRoot, { recursive: true });

  /** 期号：已有报告目录数 + 1（趣味元素，跨工作区不连号，可接受）。 */
  let existingDirs = [];
  try {
    existingDirs = fs
      .readdirSync(reportRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    existingDirs = [];
  }
  const sameDayPrefix = `${slug}-${date}`;
  const sameDay = existingDirs.filter((n) => n === sameDayPrefix || n.startsWith(`${sameDayPrefix}-`)).sort();

  let dirName = sameDayPrefix;
  let reused = false;
  if (sameDay.length > 0) {
    if (args.flags.has('reuse')) {
      dirName = sameDay[sameDay.length - 1];
      reused = true;
    } else {
      let n = 2;
      while (existingDirs.includes(`${sameDayPrefix}-${n}`)) n += 1;
      dirName = `${sameDayPrefix}-${n}`;
    }
  }

  const workspace = path.join(reportRoot, dirName);
  const created = [];
  const ensure = (abs) => {
    const existed = fs.existsSync(abs);
    fs.mkdirSync(abs, { recursive: true });
    if (!existed) created.push(path.relative(workspace, abs).split(path.sep).join('/') || '.');
  };

  ensure(workspace);
  ensure(path.join(workspace, 'evidence'));
  ensure(path.join(workspace, 'roles'));
  for (const id of effectiveRoles) ensure(path.join(workspace, 'evidence', id));

  const issueNo = reused ? existingDirs.length : existingDirs.length + 1;
  const metaPath = path.join(workspace, 'meta.json');
  const meta = {
    schema_version: SCHEMA_VERSION,
    issue_no: issueNo,
    created_at: new Date().toISOString(),
    date,
    material: {
      name: String(rawName),
      slug,
      source: args.material ? path.resolve(args.material) : null,
      types: String(args.types || '')
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    },
    mode: args.mode || 'default',
    roles: effectiveRoles,
    env_probe: envProbe,
    casting,
    access_status: args['access-status'] || null,
    workspace,
    evidence_dirs: Object.fromEntries(effectiveRoles.map((id) => [id, path.join(workspace, 'evidence', id)])),
    reused,
  };
  fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

  const gitignore = checkGitignore(findGitRoot(cwd));

  const result = {
    schema_version: SCHEMA_VERSION,
    workspace,
    workspace_posix: workspace.split(path.sep).join('/'),
    report_root: reportRoot,
    dir_name: dirName,
    slug,
    date,
    issue_no: issueNo,
    reused,
    roles: effectiveRoles,
    evidence_dirs: meta.evidence_dirs,
    report_path: path.join(workspace, 'report.md'),
    meta_path: metaPath,
    created,
    same_day_existing: sameDay,
    gitignore,
  };

  process.stdout.write(`${JSON.stringify(result, null, pretty ? 2 : 0)}\n`);
  process.stderr.write(`[init] 工作区就绪：${workspace}\n`);
  if (gitignore.hint) process.stderr.write(`[init] ${gitignore.hint}\n`);
  return 0;
}

/** 用 exitCode 而非 process.exit()，避免 Windows 管道下 stdout 被截断。 */
try {
  process.exitCode = main();
} catch (err) {
  process.stderr.write(`[init] 运行错误：${err && err.stack ? err.stack : String(err)}\n`);
  process.exitCode = 2;
}
