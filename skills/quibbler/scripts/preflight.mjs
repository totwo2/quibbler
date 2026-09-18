#!/usr/bin/env node
/**
 * preflight.mjs —— 《唱唱反调》环境探针
 *
 * 职责：探明本机 node / python / ffmpeg / ffprobe / git / agent-browser / 网络的真实可用性，
 *       并把「物理上做不到的动作」固化为 forced_red_scopes 交给主 Agent。
 *
 * 契约：
 *   - stdout：唯一一个 EnvProbe JSON 对象
 *   - stderr：所有诊断信息
 *   - 退出码：0 = 探测完成；1 = 硬依赖缺失（业务不合格）；2 = 运行错误
 *
 * 零 npm 依赖，仅用 node: 内置模块。Node 22 ESM。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

/** 本脚本的契约版本，与 SKILL.md 对齐。 */
const SCHEMA_VERSION = '1.0';

/** 单次外部命令探测的超时（毫秒）。 */
const PROBE_TIMEOUT_MS = 6000;

/** 网络连通性探测的超时（毫秒）。 */
const NETWORK_TIMEOUT_MS = 4000;

/**
 * 需要探测的可执行程序清单。
 * 纯数据表：每项只描述「叫什么名字、怎么问版本、去哪里找」，不含任何业务语义分支。
 */
const TOOL_SPECS = [
  {
    key: 'node',
    candidates: ['node'],
    versionArgs: ['--version'],
    platformKind: 'node',
    platformExe: ['node.exe', 'node'],
    hard: true,
  },
  {
    key: 'python',
    candidates: ['python', 'python3'],
    versionArgs: ['--version'],
    platformKind: 'python',
    platformExe: ['python.exe', 'python3.exe', 'python3', 'python'],
    hard: false,
  },
  { key: 'ffmpeg', candidates: ['ffmpeg'], versionArgs: ['-version'], hard: false },
  { key: 'ffprobe', candidates: ['ffprobe'], versionArgs: ['-version'], hard: false },
  { key: 'git', candidates: ['git'], versionArgs: ['--version'], hard: false },
];

/** 缺失工具 → 可复制的安装命令。纯查表。 */
const INSTALL_HINTS = {
  ffmpeg: ['winget install Gyan.FFmpeg', '或 scoop install ffmpeg', '或 choco install ffmpeg'],
  ffprobe: ['ffprobe 随 ffmpeg 一同安装：winget install Gyan.FFmpeg'],
  python: ['winget install Python.Python.3.13', '或 scoop install python'],
  git: ['winget install Git.Git'],
  agent_browser: ['该技能应位于 ~/.workbuddy/skills/agent-browser/，缺失请重新安装 agent-browser 技能'],
  network: ['检查代理设置或本机网络；离线环境下 WEB/API 类素材只能全程 🔴'],
};

/** 缺失工具 → 被物理封死的动作域。纯查表，主 Agent 据此在 Brief 中下达 🔴 禁令。 */
const FORCED_RED_TABLE = {
  ffmpeg: ['VIDEO:frame-extract', 'VIDEO:audio-transcribe', 'VIDEO:loudness'],
  ffprobe: ['VIDEO:duration-probe', 'VIDEO:av-sync'],
  python: ['CODE:python-run'],
  git: ['CODE:git-history'],
  agent_browser: ['WEB:browser-open', 'WEB:screenshot', 'WEB:keyboard-only', 'DESIGN:contrast-measure'],
  network: ['WEB:remote-url', 'API:live-request', 'ALL:web-search'],
};

/** 已装技能探测清单（软依赖，按角色加载）。存在性检查，不做能力推断。 */
const SKILL_PROBES = [
  'agent-browser',
  'xbrowser',
  'humanizer-zh',
  'markitdown-skill',
  'fanqie-masterclass',
  'multi-search-engine',
];

/** 网络探测目标，按顺序尝试，任一成功即判定连通。 */
const NETWORK_TARGETS = ['https://registry.npmjs.org/', 'https://www.baidu.com/'];

/**
 * 在 PATH 中查找可执行文件（跨平台，Windows 走 PATHEXT）。
 * @param {string} cmd 命令名，不带扩展名
 * @returns {string|null} 绝对路径，找不到返回 null
 */
function whichSync(cmd) {
  const isWin = process.platform === 'win32';
  const exts = isWin
    ? ['', ...(process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)]
    : [''];
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const rawDir of dirs) {
    const dir = rawDir.replace(/^"+|"+$/g, '');
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = path.join(dir, cmd + ext);
      try {
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        /* 目录不存在或无权限，跳过 */
      }
    }
  }
  return null;
}

/**
 * 在宿主平台自带的 binaries 目录中查找运行时（版本号倒序取最新）。
 * @param {string} kind 'node' | 'python'
 * @param {string[]} exeNames 候选可执行文件名
 * @returns {string|null}
 */
function findPlatformBinary(kind, exeNames) {
  const base = path.join(os.homedir(), '.workbuddy', 'binaries', kind, 'versions');
  let versions = [];
  try {
    versions = fs
      .readdirSync(base, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
      .reverse();
  } catch {
    return null;
  }
  for (const version of versions) {
    for (const sub of ['', 'bin']) {
      for (const exe of exeNames) {
        const candidate = path.join(base, version, sub, exe);
        try {
          if (fs.statSync(candidate).isFile()) return candidate;
        } catch {
          /* 继续找下一个 */
        }
      }
    }
  }
  return null;
}

/**
 * 执行 `<cmd> <versionArgs>` 抓取版本号首行。
 * @returns {string|null}
 */
function readVersion(exePath, versionArgs) {
  try {
    const res = spawnSync(exePath, versionArgs, {
      encoding: 'utf8',
      timeout: PROBE_TIMEOUT_MS,
      windowsHide: true,
    });
    const text = `${res.stdout || ''}${res.stderr || ''}`.trim();
    if (!text) return null;
    return text.split(/\r?\n/)[0].slice(0, 120);
  } catch {
    return null;
  }
}

/**
 * 探测单个工具。
 * @returns {{available: boolean, exe: string|null, version: string|null}}
 */
function probeTool(spec) {
  let exe = null;
  for (const name of spec.candidates) {
    exe = whichSync(name);
    if (exe) break;
  }
  if (!exe && spec.platformKind) {
    exe = findPlatformBinary(spec.platformKind, spec.platformExe || []);
  }
  if (!exe) return { available: false, exe: null, version: null };
  return { available: true, exe, version: readVersion(exe, spec.versionArgs) };
}

/**
 * 探测已装技能目录（user 级 + 内置缓存两处）。
 * @param {string} skillName
 * @returns {string|null} 命中的 SKILL.md 绝对路径
 */
function probeSkill(skillName) {
  const roots = [
    path.join(os.homedir(), '.workbuddy', 'skills', skillName, 'SKILL.md'),
    path.join(os.homedir(), '.codebuddy', 'skills', skillName, 'SKILL.md'),
    path.join(os.homedir(), '.claude', 'skills', skillName, 'SKILL.md'),
  ];
  for (const p of roots) {
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch {
      /* 下一个 */
    }
  }
  return null;
}

/**
 * 网络连通性探测。
 * @returns {Promise<boolean>}
 */
async function probeNetwork() {
  for (const url of NETWORK_TARGETS) {
    try {
      const res = await fetch(url, {
        method: 'HEAD',
        redirect: 'follow',
        signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
      });
      if (res.status > 0) return true;
    } catch {
      /* 试下一个目标 */
    }
  }
  return false;
}

function printHelp() {
  process.stderr.write(
    [
      '',
      'preflight.mjs —— 《唱唱反调》环境探针',
      '',
      '用法：',
      '  node scripts/preflight.mjs [选项]',
      '',
      '选项：',
      '  --skip-network   跳过网络连通性探测（离线或想省时间时用），network 记为 false',
      '  --out <路径>      把同一份 EnvProbe 额外落盘到指定路径，并在 stdout 回显 envprobe_path',
      '  --pretty         美化 JSON 输出（默认紧凑单行）',
      '  --help, -h       显示本帮助',
      '',
      '示例：',
      '  node scripts/preflight.mjs',
      '  node scripts/preflight.mjs --skip-network --pretty',
      '',
      '输出：stdout 为唯一一个 EnvProbe JSON；诊断信息走 stderr。',
      '退出码：0 探测完成 / 1 硬依赖缺失 / 2 运行错误',
      '',
    ].join('\n'),
  );
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return 0;
  }
  const skipNetwork = argv.includes('--skip-network');
  const pretty = argv.includes('--pretty');

  /** @type {Record<string, {available:boolean, exe:string|null, version:string|null}>} */
  const results = {};
  for (const spec of TOOL_SPECS) {
    results[spec.key] = probeTool(spec);
    process.stderr.write(
      `[preflight] ${spec.key}: ${results[spec.key].available ? results[spec.key].exe : '未找到'}\n`,
    );
  }

  /** @type {Record<string, string|null>} */
  const skills = {};
  for (const name of SKILL_PROBES) skills[name] = probeSkill(name);
  const agentBrowserCli = whichSync('agent-browser');
  const agentBrowser = Boolean(skills['agent-browser'] || agentBrowserCli);
  process.stderr.write(`[preflight] agent-browser: ${agentBrowser ? '可用' : '未找到'}\n`);

  const network = skipNetwork ? false : await probeNetwork();
  process.stderr.write(`[preflight] network: ${network}${skipNetwork ? '（已跳过探测）' : ''}\n`);

  /** 汇总能力位。node 一定为 true —— 本脚本自身就跑在 node 上。 */
  const capabilities = {
    node: true,
    python: results.python.available,
    ffmpeg: results.ffmpeg.available,
    ffprobe: results.ffprobe.available,
    git: results.git.available,
    agent_browser: agentBrowser,
    network,
  };

  const missing = Object.entries(capabilities)
    .filter(([, ok]) => !ok)
    .map(([key]) => key);

  const installHints = [];
  const forcedRedScopes = [];
  for (const key of missing) {
    for (const hint of INSTALL_HINTS[key] || []) {
      if (!installHints.includes(hint)) installHints.push(hint);
    }
    for (const scope of FORCED_RED_TABLE[key] || []) {
      if (!forcedRedScopes.includes(scope)) forcedRedScopes.push(scope);
    }
  }

  const probe = {
    schema_version: SCHEMA_VERSION,
    probed_at: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    node: capabilities.node,
    python: capabilities.python,
    ffmpeg: capabilities.ffmpeg,
    ffprobe: capabilities.ffprobe,
    git: capabilities.git,
    agent_browser: capabilities.agent_browser,
    network: capabilities.network,
    node_path: process.execPath,
    python_path: results.python.exe,
    ffmpeg_path: results.ffmpeg.exe,
    ffprobe_path: results.ffprobe.exe,
    git_path: results.git.exe,
    agent_browser_path: skills['agent-browser'] || agentBrowserCli,
    versions: {
      node: process.version,
      python: results.python.version,
      ffmpeg: results.ffmpeg.version,
      ffprobe: results.ffprobe.version,
      git: results.git.version,
    },
    skills,
    available: Object.entries(capabilities)
      .filter(([, ok]) => ok)
      .map(([key]) => key),
    missing,
    install_hints: installHints,
    forced_red_scopes: forcedRedScopes,
    network_probe_skipped: skipNetwork,
  };

  // ── 落盘 EnvProbe（阶段 1 时 workspace 尚不存在，落到调用方指定的临时路径）──
  // 保持 stdout 行为不变（主 Agent 仍要读它做判型与公示），额外把同一份落盘。
  // --out 不给值 / 写盘失败 → exit 2（不能静默 exit 0，否则下游 FALSE_ENV_EXCUSE 静默失效）。
  const outIdx = argv.indexOf('--out');
  let outPath = null;
  if (outIdx >= 0) {
    const outArg = argv[outIdx + 1];
    if (!outArg || outArg.startsWith('--')) {
      process.stderr.write('[preflight] --out 需要一个路径参数\n');
      return 2;
    }
    outPath = path.resolve(outArg);
  }
  if (outPath) {
    try {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, `${JSON.stringify(probe, null, pretty ? 2 : 0)}\n`, 'utf8');
      probe.envprobe_path = outPath.split(path.sep).join('/');
      process.stderr.write(`[preflight] EnvProbe 已落盘：${outPath}\n`);
    } catch (err) {
      process.stderr.write(`[preflight] EnvProbe 落盘失败：${err.message}\n`);
      return 2;
    }
  }

  process.stdout.write(`${JSON.stringify(probe, null, pretty ? 2 : 0)}\n`);

  const hardMissing = TOOL_SPECS.filter((s) => s.hard && !capabilities[s.key]).map((s) => s.key);
  if (hardMissing.length > 0) {
    process.stderr.write(`[preflight] 硬依赖缺失：${hardMissing.join(', ')}\n`);
    return 1;
  }
  return 0;
}

/** 用 exitCode 而非 process.exit()，避免 Windows 管道下 stdout 被截断。 */
main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    process.stderr.write(`[preflight] 运行错误：${err && err.stack ? err.stack : String(err)}\n`);
    process.exitCode = 2;
  });
