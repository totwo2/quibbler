# The Quibbler · 唱唱反调

[中文](README.md)

> Nobody has ever run your repo. Nobody has ever scrolled your page to the bottom.
> Nobody has ever finished your video. Until you publish, you are the only user.

The Quibbler brings in 5–7 AI-played personas with completely different jobs — a backend new hire, a QA engineer, a retired schoolteacher, a competitor's PM — who **actually run your code, open your page in a real browser, and read your text end to end**. Then it tells you to your face what's wrong: what they agreed on, where they disagreed, which problems are fatal, and what to fix first.

This is not one model glancing at your files and writing a paragraph: 5–7 isolated AI personas each really run, really open, really read. Every 🟢 (script-verified) conclusion in the report names a file on disk, and a script checks that the file is really there.

A skill for your AI coding agent · zero npm dependencies · Node 22+ · **read-only: it never modifies your files** · MIT

## Six things you would otherwise do by hand

| The work you'd do yourself | What it does for you |
|---|---|
| Decide what this material is and who should look at it | Classifies it into 8 material types, casts 5–7 personas from a 38-role library |
| Line people up and brief each of them | Dispatches them as concurrent subagents in a single message, with no cross-talk |
| Hope they actually opened it | They run the code, open the page, read the text; whatever the machine can't do is marked 🔴 instead of passed off as done |
| Read scattered opinions and guess which one matters | Consensus needs ≥2 personas hitting it independently; disagreements are paired, not averaged away |
| Turn feedback into something actionable | A newspaper-style report: fatal flaws, underrated highlights, a P0/P1/P2 fix list |
| Take "trust me, it's fine" on faith | Every 🟢 conclusion's artifact path is checked by a script against the filesystem |

**6 stages of process → 1 command:**

```bash
/quibbler --lite ./your-project
```

## Install

```bash
gh skill install totwo2 quibbler
```

SkillHub (CN): https://skillhub.cn/skills/quibbler · current version **v1.1.1**

## Usage

```bash
/quibbler --lite ./my-repo     # 3 personas, short report
/quibbler --full ./my-repo     # 7 personas
/quibbler --html ./my-repo     # + newspaper-style HTML report
```

Or just say it in plain language:

```
"Quibbler, look at ./my-repo"
"Review this repo the way a new hire would pick it up"
"Would this video get flamed if I posted it?"
```

| Flag | Effect |
|---|---|
| `--lite` | 3 personas + short report |
| `--full` | 7 personas |
| `--yes` | skip the lineup confirmation before the run starts |
| `--html` | also render `report.html` |
| `--roles A1,D6` | force specific personas |
| `--out <dir>` | override the default report directory |

## Confirm it works

Run one short pass and look at what landed:

```bash
/quibbler --lite ./your-project && ls .quibbler/reports/
```

A `<material>-<date>/report.md` showing up means you're set. Open it and read the three masthead numbers first — they are machine values written by `skills/quibbler/scripts/verify_report.mjs`, not estimates typed by a model. Anything your environment can't do (say, video material without ffmpeg) shows up as 🔴 with a stated reason instead of being faked.

## What you get

```
.quibbler/reports/{material}-{date}/
├── report.md      # the report
├── report.html    # only with --html
├── meta.json      # material name/slug/source, tonight's lineup, environment probe
├── evidence/{role-id}/   # screenshots, logs, command output
└── roles/{role-id}.md    # each persona's full raw experience log
```

Before anything runs, you get a lineup card and a yes/no (**illustrative, not a real run — and the product itself works in Chinese, so the card is shown untranslated; seat names are glossed below**):

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
产物：.quibbler/reports/my-repo-2026-08-07/

开印吗？
```

The report is laid out like a newspaper: a masthead plus 9 fixed sections.

> Seat gloss: 专业内核席 = professional core · 外行真人席 = real layman · 边缘用户席 = edge user · 敌对席 = adversary. Field gloss: 素材 = material · 本期阵容 = tonight's lineup · 环境 = environment · 预计 = estimate · 产物 = artifacts · 开印吗？ = run it?

| Section | What's in it |
|---|---|
| 🗞 Front page | What this thing is, and its single biggest problem |
| ⚰️ Obituaries · fatal flaws | The ones that kill it |
| 📢 Editorial · consensus | Agreement — requires ≥2 personas hitting it independently |
| ⚔️ Disputes | Where they disagreed |
| ✉️ Letters | Each persona's first-person immediate reaction |
| 💎 Underrated highlights | Every persona contributes at least one thing you dismissed |
| 🌡 Weather forecast | What will go wrong after you ship |
| 📋 Classifieds · urgent fixes | The fix list, P0/P1/P2 |
| ⚖️ Corrections & statements | What couldn't be tested, honestly logged |

The masthead numbers — real execution rate, diligence rate, coverage — are written by `skills/quibbler/scripts/verify_report.mjs`; the model is not allowed to type them. Anything only reasoned out can never enter the P0 fix list; a diligence rate below 85% fails the run outright; if credentials leak into a report, delivery stops.

## Known limitations

- **Video material needs ffmpeg.** If it's missing, the skill tries to install it (`winget install Gyan.FFmpeg`, then scoop/choco). If that fails, video personas' entries are marked 🔴 as pure reasoning, and the real execution rate drops honestly rather than being prettified.
- **`agent-browser` detection is shallow.** It sees whether the CLI exists, not whether a browser can launch. Personas self-degrade to 🔴 when their first call fails.
- **Personas are isolated within a run.** They never cite one another's views; conflicts go to the report's dispute section.
- **Very large materials are not auto-chunked.** Coverage relies on disjoint focus areas instead.
- **Re-running the same material only warns.** A real incremental diff isn't implemented yet.
- **Diagnosis only.** No automatic code fixing, no scoring or ranking, no positive marketing copy, no historical baselines.
- **A run costs time and subagent calls.** The lineup card puts that cost in front of you before you say go.

## How it works

- **Judgment belongs to the model, counting belongs to the script.** `skills/quibbler/scripts/*.mjs` only does what the filesystem can falsify: what exists, what's missing, what can't run here. Typing, casting, and clustering are done by the main agent reading `skills/quibbler/references/`.
- **Evidence is the floor.** `verify_report.mjs` walks every artifact the report claims and checks it exists. You can't fabricate a file, so you can't fabricate a 🟢.
- **Six stages, no skipping.** Guardrails and intent parsing → probes → typing and casting → cost disclosure → workspace and concurrent dispatch → synthesis and report check.
- **14 reference documents, loaded on demand.** The persona library is 38 roles in 5 groups; only the groups matching your material are read.
- **Zero-copy.** `evidence/{role-id}/` is created before dispatch, so personas write straight to agreed paths.

Consider adding `.quibbler/` to your `.gitignore`; the skill only reminds you, it never edits your files.

License: MIT
