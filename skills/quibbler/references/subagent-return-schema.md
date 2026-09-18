# 子代理返回契约（subagent-return-schema）

> **ExperienceLog v1.0 —— 子代理与主 Agent 之间唯一的数据契约。**
> **加载时机**：拼装 Brief 时（§2 骨架内嵌进 Brief 第 10 段）；回收日志做校验时（§5–§7）。
> **字段名与 `system_design.md` §3.1 类图、§4.3 契约逐字一致，任何一处改名都会击穿下游 `synthesis-rules.md` 与 `verify_report.mjs`。**

---

## 1. 返回硬规则（三条，违反即打回）

1. **唯一一个 fenced ` ```json ` 块**。块外的一切文字（寒暄、总结、解释）一律**丢弃**，不参与解析。
2. 出现 **0 个或 ≥2 个** JSON 块 → `PARSE_FAIL`，直接打回。
3. `schema_version` **恒为 `"1.0"`**。不匹配 → 打回。

**证据等级在 JSON 中一律用英文 `green` / `yellow` / `red`。**
🟢/🟡/🔴 只在**渲染进 report.md 时**才转换。理由：emoji 会在 JSON 解析、`grep`、正则统计中出幺蛾子，而 `verify_report.mjs` 的全部统计都靠 grep。

> ⚠️ **给改脚本的人：emoji 进正则，必须用 `\u{...}` 转义 + `u` 标志，绝不能直接塞进字符类。**
> 无 `u` 标志时 JS 会把星光平面字符拆成两个代理码元丢进类里：`[🔴🟥]` 实际等价于
> `[\uD83D\uDD34\uD83E\uDFE5]`，而 🟢 = U+1F7E2 = `\uD83E\uDFE2`，高位代理 `\uD83E`
> 正好落在类内 —— **绿标会被判成红标**。这类 bug 不报错、不抛异常，只是安静地把
> 合规报告判成违规（或反过来），review 时几乎看不出来。正确写法：
> `/\u{1F534}|\u{1F7E5}/u`（交替，不是字符类）。见 `verify_report.mjs` 的
> `P0_GREEN_RE` / `P0_RED_RE`。

---

## 2. Schema 骨架（内嵌进 Brief 第 10 段的就是这一段）

```jsonc
{
  "schema_version": "1.0",              // 恒为 "1.0"
  "role_id": "A3",                      // 必须等于 Brief 下发的 id
  "role_name": "林接盘",
  "seat": "professional_core",          // professional_core|layman|adversary|edge_user|crossover
  "experience_completed": true,         // 预算耗尽或步骤缺失时 false
  "budget_used": { "tool_calls": 11, "minutes": 7 },

  "step0_entry": {
    "opening": "≤80 字的第一人称开场白",
    "expectations": ["预期1", "预期2", "预期3"]        // 恰好 3 条
  },

  "step1_first_contact": {
    "limit_applied": "只看 README",                   // 实际施加的限制
    "gut_feeling": "第一直觉，一句话",
    "guess": "我猜这是干什么的",
    "guess_accuracy": "wrong"                         // right|partial|wrong
  },

  "step2_main_path": [                                // ≥3 条
    {
      "t": "00:00",                                   // 相对时间 mm:ss，从 step0 起算
      "action": "我做了什么",
      "expected": "我以为会怎样",
      "actual": "实际怎样",
      "duration_s": 214,
      "evidence": { /* EvidenceRef，见 §3 */ }
    }
  ],

  "step3_edge_attempts": [                            // ≥3 条
    {
      "t": "00:20",
      "attempt": "我故意做了什么非常规操作",
      "result": "结果如何",
      "evidence": { /* EvidenceRef */ }
    }
  ],

  "step4_friction_log": [                             // 可为空数组，空时 self_check.friction_empty_reason 必填
    {
      "where": "卡在哪（文件:行号 / URL / 时间点）",
      "stuck_seconds": 300,
      "i_thought": "我当时以为",
      "actually": "实际是",
      "evidence": { /* EvidenceRef */ }
    }
  ],

  "step5_emotion_curve": [                            // 5–8 点，必含全局最低分与最高分
    { "t": "00:00", "score": 6, "inner_voice": "一句心声" }
  ],

  "step6_verdict": {
    "will_continue": true,
    "why": "会/不会继续用的理由，一句话",
    "fatal_flaws": [                                  // ≤2 条
      {
        "title": "问题标题",
        "phenomenon": "现象（事实）",
        "impact": "影响（谁受损、损多少）",
        "evidence": { /* EvidenceRef */ },
        "suggestion": "怎么改",
        "acceptance": "改完怎么验收",
        "effort": "S"                                 // S|M|L
      }
    ],
    "underrated_highlights": [                        // ≥1 条，硬性
      { "title": "被低估的优点", "why_it_matters": "为什么这对我重要" }
    ],
    "one_line_to_author": "给作者的一句话"
  },

  "evidence_files": ["evidence/A3/01-npm-install.log"],   // 本角色写盘的全部文件，相对报告路径
  "degradation_reasons": [                                // 存在 red 时不得为空
    {
      "what": "没做成的事",
      "why": "为什么做不成",
      "cause": "env_missing",        // 四值之一，必填，见 §3.3
      "tool": "git",                 // cause=env_missing 时必填，枚举对齐 EnvProbe key（git/ffmpeg/browser/network…）
      "how_user_can_verify": "用户怎么补验"
    }
  ],
  "self_check": {
    "steps_completed": [0, 1, 2, 3, 4, 5, 6],
    "green": 8, "yellow": 2, "red": 0,
    "no_adjectives_before_step6": true,
    "edge_attempts_count": 3,
    "highlights_count": 1,
    "friction_empty_reason": null
  }
}
```

---

## 3. EvidenceRef 子结构

```jsonc
{
  "level": "green",          // green|yellow|red
  "type": "command",         // command|browser|file|frame|search|reasoning
  "value": "npm install",    // 命令行 / URL / 文件:行号 / 时间戳 / 检索式
  "exit_code": 1,            // type=command 时必填；其余置 null
  "digest": "gyp ERR! ...",  // 输出摘要 ≤3 行；无输出置 null
  "artifact": "evidence/A3/01-npm-install.log"   // 相对报告的路径，条件必填见下
}
```

### 3.1 level × type 组合矩阵

| type | 含义 | `value` 写什么 | `exit_code` | `artifact` |
|---|---|---|---|---|
| `command` | 跑了命令 | 完整命令行 | **必填** | green 时**必填**且文件须存在 |
| `browser` | 浏览器操作 | URL + 动作描述 | null | green 时**必填**（截图 .png） |
| `frame` | 视频抽帧 | 时间点，如 `00:03` | null | green 时**必填**（帧图 .png/.jpg） |
| `file` | 读了文件 | `路径:行号` 或 `路径:起-止` | null | **green 时必填**（摘录文本须真实落盘存在）；yellow 选填 |
| `search` | 网络检索 | 检索式 + 命中来源 | null | **green 时必填**（结果摘要 .md 须真实存在）；yellow 选填 |
| `reasoning` | 纯推演 | 推演依据一句话 | **必须 null** | **禁止填**；且 level 只能是 `red`（verify 现强制机检 `REASONING_NOT_RED`） |

### 3.2 三条铁律

1. **`level = "green"`（无论 `type`）→ `artifact` 必填，且该文件必须真实存在于磁盘。** 绿=实测，实测必留痕，与 type 无关（原 `command/browser/frame` 白名单已退役）。→ 文件不存在即 `ARTIFACT_DANGLING`；green 但 artifact 为空即 `ARTIFACT_REQUIRED`。
2. `type = "reasoning"` → `level` 只能是 `red`，`artifact` 必须为 `null`。推演不产生证据文件。（verify 现强制机检 `REASONING_NOT_RED`：level≠red 或 artifact 非空都报。）
3. 任一 `level = "red"` 存在 → `degradation_reasons` **不得为空数组**。→ 违反即 `RED_NO_REASON`。

### 3.3 `degradation_reasons[].cause` 四值枚举【v1.1】

**在数据层就把「偷懒」和「跑不了」分开。** 子代理本来就要写 `why`，只是多勾一个枚举，零额外思考成本。
真正价值：让 `verify_report.mjs` **不用猜**一条 red 到底是环境问题还是模型偷懒——猜是猜不准的，**必须在产生端标注**。

| 枚举值 | 含义 | 可从尽责率分母扣除 |
|---|---|---|
| `env_missing` | 环境缺工具（ffmpeg / Chrome / 编译器…） | ✅ 可扣 | **须同时填 `tool` 字段**（枚举对齐 `EnvProbe.available` 的 key，如 `git` / `ffmpeg` / `browser` / `network`）。缺 `tool` → `ENV_REASON_UNSTRUCTURED`；`tool` 指向的工具在 EnvProbe 中显示可用 → `FALSE_ENV_EXCUSE` 强制改判 `budget_exhausted`。 |
| `access_denied` | 无凭据 / 无权限 / 付费墙 | ✅ 可扣，报头**单列** |
| `budget_exhausted` | 预算耗尽 | ❌ **不可扣——这就是偷懒** |
| `not_applicable` | 该动作对本素材无意义（纯后端仓库谈不上首屏） | ✅ 可扣 |

```
diligence_rate = green / (total_conclusions − excusable_red)
excusable_red  = cause ∈ {env_missing, access_denied, not_applicable} 的 red 条数
```

> `budget_exhausted` **不可扣除是这个指标的全部意义所在**。预算耗尽就是没认真跑，必须计入分母拉低尽责率。
> 若允许扣除，子代理只要全写 `budget_exhausted` 就能刷到 100%，指标当场作废。

### 3.4 两条反滥用交叉核对【v1.1 + v1.2】

`cause` 由子代理自报，所以两条**可扣**路径都必须有**派发前客观事实**来对账。二者完全同构：

| 违规码 | 子代理声称 | 对账依据（派发前就固定） | 命中处置 |
|---|---|---|---|
| `FALSE_ENV_EXCUSE` | `cause = env_missing` | `EnvProbe` 显示该工具**可用** | 强制改判 `budget_exhausted`，计入分母重算 |
| `FALSE_ACCESS_EXCUSE` | `cause = access_denied` | `meta.json.access_status != refused` | 强制改判 `budget_exhausted`，计入分母重算 |

**`access_denied` 的判定权不在子代理手里【v1.2】**：

子代理是**隔离上下文的 worker，它根本没有向用户实时索要凭据的通道**。凭据协商发生在**主 Agent ↔ 用户**这一层，**在派发之前**。因此：

- `Brief.access_status` 三值由主 Agent 派发前按与用户的实际交互填写：
  `provided`（用户给了凭据）/ `refused`（**问过**且用户**明确拒绝**）/ `not_required`（素材本就不需要登录）
- **`cause = "access_denied"` 仅当 `access_status == "refused"` 时合法。**
- `access_status` 同时写进 `meta.json`，`verify_report.mjs` 交叉核对。

> 这条的设计教训值得记下来：**当一条规则要求执行者"如实汇报他有没有做某件事"，先问这件事他在架构上做不做得到。** 做不到的话，规则再严也只是在制造合规表演。原先靠 Brief 提示词要求子代理"如实说明你是被拒绝了还是没问就放弃"——而它根本没有"问"的通道。判定权上移后，这条从盲区变成可机检。

---

## 4. 字段约束表（校验器逐条比对）

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `schema_version` | string | ✓ | 恒为 `"1.0"` |
| `role_id` | string | ✓ | 必须等于 Brief 中下发的 id |
| `role_name` | string | ✓ | 必须等于角色卡姓名 |
| `seat` | enum | ✓ | `professional_core` / `layman` / `adversary` / `edge_user` / `crossover` |
| `experience_completed` | bool | ✓ | 预算耗尽或步骤缺失时为 false |
| `budget_used.tool_calls` | int | ✓ | ≥0，超过 Brief 预算时 `experience_completed` 应为 false |
| `budget_used.minutes` | int | ✓ | ≥0 |
| `step0_entry.opening` | string | ✓ | **≤80 字** |
| `step0_entry.expectations` | string[] | ✓ | **恰好 3 条** |
| `step1_first_contact.limit_applied` | string | ✓ | 非空 |
| `step1_first_contact.gut_feeling` | string | ✓ | 非空 |
| `step1_first_contact.guess` | string | ✓ | 非空 |
| `step1_first_contact.guess_accuracy` | enum | ✓ | `right` / `partial` / `wrong` |
| `step2_main_path` | Step[] | ✓ | **≥3 条**；每条含 `t/action/expected/actual/duration_s/evidence` |
| `step2_main_path[].t` | string | ✓ | `mm:ss`，相对 step0 起算，单调不减 |
| `step2_main_path[].duration_s` | int | ✓ | ≥0 |
| `step3_edge_attempts` | EdgeAttempt[] | ✓ | **≥3 条**；每条含 `t/attempt/result/evidence` |
| `step4_friction_log` | Friction[] | ✓ | **可为空数组**，为空时 `self_check.friction_empty_reason` 必填非空 |
| `step4_friction_log[].stuck_seconds` | int | ✓ | ≥0 |
| `step5_emotion_curve` | EmotionPoint[] | ✓ | **5–8 点**；`score` ∈ [0,10] 整数；**必须同时出现全场最低分与最高分**；`t` 单调不减 |
| `step6_verdict.will_continue` | bool | ✓ | — |
| `step6_verdict.why` | string | ✓ | 非空 |
| `step6_verdict.fatal_flaws` | Flaw[] | ✓ | **≤2 条**；可为空数组；每条七字段齐全 |
| `step6_verdict.fatal_flaws[].effort` | enum | ✓ | `S` / `M` / `L` |
| `step6_verdict.underrated_highlights` | Highlight[] | ✓ | **≥1 条（硬性）**；每条含 `title` / `why_it_matters` |
| `step6_verdict.one_line_to_author` | string | ✓ | 非空，≤50 字 |
| `evidence.level` | enum | ✓ | `green` / `yellow` / `red`（英文，禁 emoji） |
| `evidence.type` | enum | ✓ | `command` / `browser` / `file` / `frame` / `search` / `reasoning` |
| `evidence.artifact` | string\|null | 条件必填 | `level=green` 且 `type∈{command,browser,frame}` 时**必填且文件须真实存在于磁盘** |
| `evidence_files` | string[] | ✓ | 本角色写盘全部文件的相对路径；须为所有 `artifact` 值的超集 |
| `degradation_reasons` | Degradation[] | ✓ | **任一 red 存在时不得为空**；每条含 `what` / `why` / **`cause`** / `how_user_can_verify` |
| `degradation_reasons[].cause` | enum | ✓ | **`env_missing` / `access_denied` / `budget_exhausted` / `not_applicable`** 四值之一，见 §3.3。缺失或越界 → `RED_NO_REASON` |
| `degradation_reasons[].tool` | enum | 条件（cause=`env_missing` 时必填） | 对齐 `EnvProbe.available` key 的枚举：`git` / `ffmpeg` / `ffprobe` / `python` / `node` / `browser`（→`agent_browser`）/ `network`。缺失 → `ENV_REASON_UNSTRUCTURED`；与 EnvProbe 硬比对，显示可用 → `FALSE_ENV_EXCUSE` |
| ↳ `cause = env_missing` | — | 条件 | 该工具须在 `EnvProbe` 中显示**不可用**，否则 → `FALSE_ENV_EXCUSE` |
| ↳ `cause = access_denied` | — | 条件 | 仅当 `Brief.access_status == "refused"` 时合法，否则 → `FALSE_ACCESS_EXCUSE` |
| `self_check.steps_completed` | int[] | ✓ | 必须含 `[0,1,2,3,4,5,6]` 全集 |
| `self_check.green/yellow/red` | int | ✓ | 三者之和 == 全文 EvidenceRef 总数 |
| `self_check.no_adjectives_before_step6` | bool | ✓ | 自述，主 Agent 抽查 |
| `self_check.edge_attempts_count` | int | ✓ | 必须 == `step3_edge_attempts.length` |
| `self_check.highlights_count` | int | ✓ | 必须 == `underrated_highlights.length` |
| `self_check.friction_empty_reason` | string\|null | 条件必填 | `step4_friction_log` 为空数组时必填 |

**每条结论必挂 evidence**：`step2_main_path` / `step3_edge_attempts` / `step4_friction_log` / `fatal_flaws` 的**每一个元素**都必须有 `evidence` 对象且 `evidence.level` 非空。→ 违反即 `EVIDENCE_MISSING`。

---

## 5. 合法完整样例（可直接 `JSON.parse`）

```json
{
  "schema_version": "1.0",
  "role_id": "A3",
  "role_name": "林接盘",
  "seat": "professional_core",
  "experience_completed": true,
  "budget_used": { "tool_calls": 11, "minutes": 7 },
  "step0_entry": {
    "opening": "我入职第三天，被告知这个项目归我了。原作者上周走的，没有交接。",
    "expectations": ["README 能原样跑通", "关键分支有注释", "半天内能看懂主流程"]
  },
  "step1_first_contact": {
    "limit_applied": "只看 README，未打开任何源码",
    "gut_feeling": "字不多，三步安装",
    "guess": "一个 CLI 工具，装完就能用",
    "guess_accuracy": "wrong"
  },
  "step2_main_path": [
    {
      "t": "00:00",
      "action": "按 README 执行 npm install",
      "expected": "依赖装完",
      "actual": "node-gyp 报错，退出码 1",
      "duration_s": 214,
      "evidence": {
        "level": "green", "type": "command", "value": "npm install",
        "exit_code": 1, "digest": "gyp ERR! find Python\ngyp ERR! stack Error: Could not find any Python",
        "artifact": "evidence/A3/01-npm-install.log"
      }
    },
    {
      "t": "00:04",
      "action": "切到 Node 18 重装",
      "expected": "还是会挂",
      "actual": "装成功，耗时 96 秒",
      "duration_s": 96,
      "evidence": {
        "level": "green", "type": "command", "value": "nvm use 18 && npm install",
        "exit_code": 0, "digest": "added 412 packages in 96s",
        "artifact": "evidence/A3/02-node18-retry.log"
      }
    },
    {
      "t": "00:07",
      "action": "npm start",
      "expected": "起一个本地服务",
      "actual": "进程立刻退出，无任何输出，退出码 0",
      "duration_s": 3,
      "evidence": {
        "level": "green", "type": "command", "value": "npm start",
        "exit_code": 0, "digest": "(no output)",
        "artifact": "evidence/A3/03-npm-start.log"
      }
    }
  ],
  "step3_edge_attempts": [
    {
      "t": "00:12",
      "attempt": "传空字符串作为参数",
      "result": "未捕获异常，堆栈直接打到 stdout",
      "evidence": {
        "level": "green", "type": "command", "value": "node cli.mjs \"\"",
        "exit_code": 1, "digest": "TypeError: Cannot read properties of undefined (reading 'length')",
        "artifact": "evidence/A3/04-empty-arg.log"
      }
    },
    {
      "t": "00:14",
      "attempt": "传 10 万字符的参数",
      "result": "进程无响应 60 秒后被我手动杀掉",
      "evidence": {
        "level": "green", "type": "command", "value": "node cli.mjs $(python -c \"print('a'*100000)\")",
        "exit_code": 130, "digest": "(timeout, killed at 60s)",
        "artifact": "evidence/A3/05-huge-input.log"
      }
    },
    {
      "t": "00:17",
      "attempt": "构建到一半 Ctrl+C 中断，再重新构建",
      "result": "dist/ 留下半成品，第二次构建未清理，产物混合",
      "evidence": {
        "level": "yellow", "type": "command", "value": "npm run build (SIGINT at 8s) && npm run build",
        "exit_code": 0, "digest": "dist/ 中同时存在新旧两批 chunk 文件",
        "artifact": "evidence/A3/06-sigint.log"
      }
    }
  ],
  "step4_friction_log": [
    {
      "where": "README.md:12「Node 16+」",
      "stuck_seconds": 300,
      "i_thought": "我的 Node 22 肯定没问题",
      "actually": "实际要求 >=18 且 <21，22 会在 node-gyp 阶段挂",
      "evidence": {
        "level": "green", "type": "file", "value": "README.md:12",
        "exit_code": null, "digest": "> 环境要求：Node 16+",
        "artifact": "evidence/A3/07-readme-excerpt.txt"
      }
    },
    {
      "where": "src/core.ts 整个文件",
      "stuck_seconds": 420,
      "i_thought": "看一眼就知道它干什么",
      "actually": "412 行单函数，读到第 200 行时我已经不记得开头的变量了",
      "evidence": {
        "level": "yellow", "type": "file", "value": "src/core.ts:1-412",
        "exit_code": null, "digest": "单个导出函数 412 行，最深嵌套 7 层",
        "artifact": null
      }
    }
  ],
  "step5_emotion_curve": [
    { "t": "00:00", "score": 6, "inner_voice": "试试看，看着挺简单" },
    { "t": "00:04", "score": 3, "inner_voice": "又是环境问题" },
    { "t": "00:07", "score": 2, "inner_voice": "起是起来了，但什么都没发生" },
    { "t": "00:11", "score": 1, "inner_voice": "我是不是不适合干这行" },
    { "t": "00:18", "score": 2, "inner_voice": "好歹知道怎么跑了" },
    { "t": "00:25", "score": 4, "inner_voice": "错误码那个文件写得是真讲究" }
  ],
  "step6_verdict": {
    "will_continue": true,
    "why": "会接手，但第一件事是重写 README——不是自愿的",
    "fatal_flaws": [
      {
        "title": "README 的 Node 版本要求是错的",
        "phenomenon": "文档写 Node 16+，实测 22 在 node-gyp 阶段直接失败，退出码 1",
        "impact": "新人首次安装 100% 失败，我个人损耗 5 分钟，团队每来一人损耗一次",
        "evidence": {
          "level": "green", "type": "command", "value": "npm install",
          "exit_code": 1, "digest": "gyp ERR! find Python",
          "artifact": "evidence/A3/01-npm-install.log"
        },
        "suggestion": "README 改为 >=18 <21，并在 package.json 加 engines 字段做硬拦截",
        "acceptance": "干净容器内按 README 一次成功；Node 22 下 npm install 给出明确版本提示而非 gyp 堆栈",
        "effort": "S"
      },
      {
        "title": "npm start 静默退出，没有任何提示",
        "phenomenon": "执行 npm start 后进程 3 秒退出，退出码 0，stdout 为空",
        "impact": "使用者无法判断是启动成功还是失败，我在这里停了 4 分钟才去看源码",
        "evidence": {
          "level": "green", "type": "command", "value": "npm start",
          "exit_code": 0, "digest": "(no output)",
          "artifact": "evidence/A3/03-npm-start.log"
        },
        "suggestion": "启动时打印监听地址；配置缺失时以非 0 退出码 + 一行原因退出",
        "acceptance": "缺配置时 npm start 退出码非 0 且 stderr 有明确一行说明",
        "effort": "S"
      }
    ],
    "underrated_highlights": [
      {
        "title": "错误码定义文件极其规整",
        "why_it_matters": "src/errors.ts 里每个错误码都有编号、场景、建议动作三段式，明显有人认真设计过。接手时这是唯一让我安心的地方——说明这个项目原来是有人在乎的。"
      }
    ],
    "one_line_to_author": "你上次在干净环境装过自己的项目是什么时候？"
  },
  "evidence_files": [
    "evidence/A3/01-npm-install.log",
    "evidence/A3/02-node18-retry.log",
    "evidence/A3/03-npm-start.log",
    "evidence/A3/04-empty-arg.log",
    "evidence/A3/05-huge-input.log",
    "evidence/A3/06-sigint.log",
    "evidence/A3/07-readme-excerpt.txt"
  ],
  "degradation_reasons": [],
  "self_check": {
    "steps_completed": [0, 1, 2, 3, 4, 5, 6],
    "green": 8,
    "yellow": 2,
    "red": 0,
    "no_adjectives_before_step6": true,
    "edge_attempts_count": 3,
    "highlights_count": 1,
    "friction_empty_reason": null
  }
}
```

**样例自洽核对**：EvidenceRef 共 10 个（step2×3 + step3×3 + step4×2 + flaws×2）→ green 8 / yellow 2 / red 0 ✓；情绪曲线 6 点，最低 1 与最高 6 均在 ✓；`degradation_reasons` 为空且无 red ✓；两条 flaw 的 artifact 复用 step2 已落盘文件，均在 `evidence_files` 内 ✓。

### 5.1 `degradation_reasons` 带 `cause` 的片段示例

上面的样例无 red，故 `degradation_reasons` 为空。下面是**有 red 时**该字段的正确写法（D6 冯抬杠 体验视频、ffmpeg 缺失、`access_status = refused` 的场景）：

```json
[
  {
    "what": "未能抽取任何视频帧，全程没有看到画面",
    "why": "本机 ffmpeg / ffprobe 均不存在，EnvProbe.missing 含 ffmpeg，属 forced_red_scopes",
    "cause": "env_missing",
    "how_user_can_verify": "安装 ffmpeg（winget install Gyan.FFmpeg）后重跑本技能，即可获得逐帧证据"
  },
  {
    "what": "未能核实文案引用的《2026 行业白皮书》原文数据",
    "why": "该报告需付费订阅，主 Agent 询问后用户明确拒绝提供账号（access_status=refused）",
    "cause": "access_denied",
    "how_user_can_verify": "提供订阅账号后重跑，或由用户自行核对该报告第 12 页的市场份额口径"
  },
  {
    "what": "未逐句检索全部 37 条字幕中的宣称，只检索了前 12 条",
    "why": "工具调用预算 8 次已用尽，剩余 25 条未覆盖",
    "cause": "budget_exhausted",
    "how_user_can_verify": "用 --full 模式重跑可获得完整检索；或人工核对剩余条目"
  }
]
```

**注意第三条**：预算耗尽就老实写 `budget_exhausted`。它**不可从尽责率分母扣除**，会如实拉低尽责率——这正是这个指标存在的意义。把它伪装成 `env_missing` 会被 `FALSE_ENV_EXCUSE` 抓出并强制改判，**改判后照样计入分母，白撒谎一次**。

---

## 6. 主 Agent 校验清单（按顺序执行，短路返回）

| # | 检查 | 命中的违规码 | 机检 |
|---|---|---|---|
| V1 | 提取唯一 fenced json 块并 `JSON.parse` 成功 | `PARSE_FAIL` | 🔒 `verify_report.mjs`（`roles/*.json` 解析失败即报；`.md` 内嵌块为尽力而为，仍需主 Agent 回收时把关） |
| V2 | `schema_version == "1.0"` 且 `role_id` 等于下发值 | `PARSE_FAIL` | 👁 主 Agent 回收环节（verify **不**比对版本号与 role_id 一致性） |
| V3 | `self_check.steps_completed ⊇ [0..6]`，且七步字段全部存在非空 | `MISSING_STEP` | 👁 模型软自检 |
| V4 | `step0_entry.expectations.length == 3` 且 `step2_main_path.length >= 3` | `MISSING_STEP` | 👁 模型软自检 |
| V5 | `step3_edge_attempts.length >= 3` | `EDGE_TOO_FEW` | 👁 模型软自检 |
| V6 | `step5_emotion_curve` 长度 ∈ [5,8] 且含全局最低与最高分 | `CURVE_BAD` | 👁 模型软自检 |
| V7 | `underrated_highlights.length >= 1` | `NO_HIGHLIGHT` | 👁 模型软自检 |
| V8 | 四类条目每一条都有 `evidence.level` 且值 ∈ {green,yellow,red} | `EVIDENCE_MISSING` | 🔒 `verify_report.mjs` |
| V9 | 若存在 red，则 `degradation_reasons.length >= 1` 且每条**四字段**齐全（含 `cause`），`cause` ∈ 四值 | `RED_NO_REASON` | 🔒 `verify_report.mjs` |
| V10 | **每个 green 的 artifact 在磁盘上真实存在**（与 type 无关） | `ARTIFACT_DANGLING` / `ARTIFACT_REQUIRED` | 🔒 `verify_report.mjs` |
| V11 | 每条 `cause = env_missing` 的工具（结构化 `tool` 字段）在 `EnvProbe` 中确为不可用 | `FALSE_ENV_EXCUSE` / `ENV_REASON_UNSTRUCTURED` | 🔒 `verify_report.mjs` |
| V12 | 若出现 `cause = access_denied`，则 `meta.json.access_status == "refused"` | `FALSE_ACCESS_EXCUSE` | 🔒 `verify_report.mjs` |
| V13 | 抽查 step0–step5 文本，无评价性形容词 | `ADJECTIVE_LEAK` | 👁 模型软自检 |
| V14 | 全文不含用户提供的凭据明文 | `CREDENTIAL_ECHO`（→ `credential_leak`） | 🔒 `verify_report.mjs` 全文扫描 |

> **图例**：🔒 = 机器硬闸门（`verify_report.mjs` 强制，命中即 exit 1，不可绕过）；👁 = 模型软自检（脚本**零实现**，由主 Agent 在回收环节抽查与打回，跳过就是真的没人查）。
>
> 机检 8 项：V1（`roles/*.json` 解析）· V8 · V9 · V10 · V11 · V12 · V14，外加 `REASONING_NOT_RED`（推演铁律，见 §3.2 铁律 2，未单列 V 号）。
> 软检 7 项：V2 · V3 · V4 · V5 · V6 · V7 · V13。**别把软检当成脚本会帮你拦。**

**V10 的执行方式**（不许目测）：
```bash
# 对每个待核 artifact，以工作区绝对路径拼接后逐个 test -f
test -f "{workspace}/evidence/A3/01-npm-install.log" && echo OK || echo DANGLING
```
或一次性交给 `verify_report.mjs` 的 `dangling_evidence` 字段。**主 Agent 不得凭子代理的 `self_check` 自述通过 V10。**

---

## 7. 十二个违规码 · 命中条件与打回话术

> 打回**只重试一次**。话术插入 `subagent-prompt-template.md` §8 的重试 Brief 的 `{violations}` 位置。

### 7.1 `PARSE_FAIL`
**命中**：返回中找不到唯一合法 JSON 块（0 块 / ≥2 块 / `JSON.parse` 抛错 / `schema_version` 不为 `"1.0"` / `role_id` 与下发值不符）。
**打回话术**：
> `PARSE_FAIL` —— 你的返回没能被解析。原因：{具体，如"出现了 2 个 json 代码块"/"第 47 行缺少逗号"/"role_id 返回 A4，下发的是 A3"}。
> 请**只输出一个** ```json 代码块，块外一个字都不要写。不要重跑任何命令，把你上次的内容原样整理成合法 JSON 即可。

### 7.2 `MISSING_STEP`
**命中**：`self_check.steps_completed` 不含 0–6 全集；或某步字段缺失/为空；或 `expectations ≠ 3` 条；或 `step2_main_path < 3` 条。
**打回话术**：
> `MISSING_STEP` —— DXP 七步缺了第 {n} 步（{步骤名}）。缺失项：{列表}。
> 请补齐这一步。**已完成的步骤保留原样，不要重跑已成功的命令**。
> 如果这一步确实做不到（如无法访问），也要把该步写出来，用 `red` 证据说明为什么做不到。

### 7.3 `EDGE_TOO_FEW`
**命中**：`step3_edge_attempts.length < 3`。
**打回话术**：
> `EDGE_TOO_FEW` —— 边缘尝试只有 {n} 次，硬性要求至少 3 次。
> 补 {3-n} 次非常规操作即可，从这些方向选：错误输入 / 空输入 / 超大输入 / 中途中断 / 连续点击 / 极端视口 / 断网 / 权限不足 / 重复提交。
> 只做补充的这几次，其余部分原样保留。

### 7.4 `CURVE_BAD`
**命中**：`step5_emotion_curve` 点数 <5 或 >8；或未同时包含该数组的最低分与最高分；或 `score` 越界 [0,10]；或 `t` 非 `mm:ss` 格式。
**打回话术**：
> `CURVE_BAD` —— 情绪曲线不合格：{具体，如"只有 4 个采样点"/"全部是 5 分，没有波动，缺最低/最高对比"}。
> 请给出 5–8 个采样点，覆盖你的**全场最低点与最高点**，每点 0–10 分 + 一句心声。
> 这一步不需要重跑任何操作，凭你已有的体验回忆填写即可。

### 7.5 `NO_HIGHLIGHT`
**命中**：`underrated_highlights` 为空数组或缺字段。
**打回话术**：
> `NO_HIGHLIGHT` —— `underrated_highlights` 是空的。这是硬性要求，至少 1 条。
> **找不出优点说明你没认真看，不是它没有优点。** 回头找：哪怕是一个命名规范、一条报错文案、一个默认值的选择、一个你没被坑到的地方。
> 写清 `title` 和 `why_it_matters`（为什么这一点对**你这个角色**重要）。其余部分原样保留。

### 7.6 `EVIDENCE_MISSING`
**命中**：`step2_main_path` / `step3_edge_attempts` / `step4_friction_log` / `fatal_flaws` 中任一元素缺 `evidence` 对象或缺 `evidence.level`。
**打回话术**：
> `EVIDENCE_MISSING` —— 以下条目没有挂证据：{路径列表，如 `step2_main_path[2]`、`fatal_flaws[0]`}。
> 每一条结论都必须挂 `evidence{level,type,value,exit_code,digest,artifact}`。
> 如果这条结论本来就没跑过，就老实标 `level: "red"`、`type: "reasoning"`，并在 `degradation_reasons` 补一条。**不要为了凑 green 编命令。**

### 7.7 `RED_NO_REASON`
**命中**：存在 `level == "red"` 的证据，但 `degradation_reasons` 为空数组，或其中某条缺 `what`/`why`/`how_user_can_verify`。
**打回话术**：
> `RED_NO_REASON` —— 你有 {n} 条 red 证据，但 `degradation_reasons` 是空的（或字段不全）。
> 每一条 red 都必须对应登记：`what`（没做成什么）/ `why`（为什么做不成，要具体到缺什么工具、缺什么权限）/ `how_user_can_verify`（用户装了什么、给了什么之后可以自己补验）。
> 这一步不需要重跑，补写即可。

### 7.8 `ARTIFACT_DANGLING` ⚠️ **最重要的一条**
**命中**：某条 `level == "green"` 且 `type ∈ {command, browser, frame}` 的证据声明了 `artifact` 路径，但**该文件在磁盘上不存在**；或 `artifact` 为 null/空；或 `artifact` 不在 `evidence_files` 列表内。

**为什么这条最重**：
`green` 的含义是「我真跑过」。声称真跑过、却拿不出那个文件，**只有两种可能：要么你没跑，要么你跑了但没落盘。前者是伪造证据，后者是证据缺失——两者都让这份报告失去地基。**
本技能全部可信度建立在「artifact 会被机器逐个 `test -f`」这一条上。模型可以编造命令、编造退出码、编造输出摘要，**但编不出一个真实存在的文件**。这是唯一无法被语言模型绕过的校验点。所以：

- 这条校验**必须由主 Agent 用文件系统实际核对**，不得采信子代理的 `self_check` 自述。
- 这条命中时**不允许**通过"补写文件"来补救——事后补写的文件不能证明当时跑过。正确的补救是**把该证据降级为 yellow 或 red 并说明**。
- 二次仍命中 → 该角色**整份日志的所有 green 一律降级为 yellow**，`experience_completed: false`，末版《更正与声明》**点名登记**：「{角色名} 声明的 {n} 个证据文件不存在，其结论已整体降级」。

**打回话术**：
> `ARTIFACT_DANGLING` —— 你声明了这些证据文件，但它们**在磁盘上不存在**：
> {dangling 列表，逐个列出 artifact 路径}
>
> 你标了 `green`（实测），意思是你真的跑过。但拿不出文件。现在只有两条路，**没有第三条**：
> **A. 你确实跑过，只是忘了落盘** → 现在把命令**重跑一次**并把输出重定向写入该路径：
>    `命令 > "{绝对路径}/01-xxx.log" 2>&1`，写完确认文件存在，再把 artifact 保持原样。
> **B. 你其实没跑，或跑了但拿不到输出** → 把该条证据 `level` 从 `green` 改为 `yellow` 或 `red`，
>    `artifact` 置为 `null`，并在 `degradation_reasons` 里如实登记。
>
> **不要凭空写一个新文件名来蒙混。** 所有 artifact 都会被再核对一次。诚实降级不扣分，伪造证据整份作废。

### 7.9 `FALSE_ENV_EXCUSE`【v1.1】
**命中**：某条 `degradation_reasons[].cause == "env_missing"`，但其指向的工具在 `EnvProbe` 中显示**可用**（如声称"没有 git 所以没看提交历史"，而 `EnvProbe.git == true`）。
**为什么要有这条**：`env_missing` 是**可从尽责率分母扣除**的，`budget_exhausted` 不可扣。这中间有套利空间——把"我没时间跑"写成"环境跑不了"，尽责率就好看了。这条堵死它。
**处置**：该条**强制改判为 `budget_exhausted`**，计入分母重算 `diligence_rate`。**改判不可申诉**——`EnvProbe` 是派发前的客观事实，比子代理的事后声称可信。
**打回话术**：
> `FALSE_ENV_EXCUSE` —— 你声称 {工具名} 不可用，但派发前的环境探针显示它**是可用的**：{EnvProbe 对应字段}。
> 这条已被**强制改判为 `budget_exhausted`** 并计入尽责率分母。
> 如果你确实尝试过而它报错了，请把**报错输出落盘**并把 `cause` 保持 `env_missing`，同时附上 artifact 证明它真的跑不了；
> 如果你只是没时间跑，就老实写 `budget_exhausted`——**改判后照样计入分母，伪报一次是白撒谎。**

### 7.10 `FALSE_ACCESS_EXCUSE`【v1.2】
**命中**：返回中出现 `degradation_reasons[].cause == "access_denied"`，但 `meta.json.access_status != "refused"`（即主 Agent 从未向用户索要过凭据，或用户其实已经提供了，或该素材根本不需要登录）。
**为什么要有这条**：与 `FALSE_ENV_EXCUSE` **完全同构**——都是拿"派发前的客观事实"对"子代理的事后声称"做交叉核对。至此 `env_missing` 与 `access_denied` 两条可扣路径**都不再由子代理说了算**。
**特别说明**：子代理**没有向用户索要凭据的通道**（隔离上下文的 worker），所以它其实无从判断"我是被拒绝了还是没人问过"。这不是它的错——判定权本就不该放在它那层。因此这条的打回话术**不指责子代理撒谎**，而是直接告知客观状态并要求改标。
**打回话术**：
> `FALSE_ACCESS_EXCUSE` —— 你用了 `cause: "access_denied"`，但本次派发的 `access_status` 是 **{provided / not_required}**，不是 `refused`。
> 说明：凭据协商发生在主 Agent 与用户之间、在派发之前，**你没有这个通道，无从判断，这不怪你**。
> 客观状态是：{`not_required` → 这个素材本就不需要登录 / `provided` → 凭据已在 Brief 里给你了，请回去找「登录凭据」段}。
> 请把该条 `cause` 改为 `budget_exhausted` 或 `not_applicable`（按实际情况），其余原样保留。
> 若是 `provided` 而你没找到凭据，请说明你在哪一步卡住了——这是 Brief 的问题，我们会修。

### 7.11 `ADJECTIVE_LEAK`
**命中**：抽查 `step0_entry` ~ `step5_emotion_curve` 的文本字段，出现评价性形容词。违禁词参考清单：
`好 / 差 / 优雅 / 糟糕 / 流畅 / 混乱 / 丝滑 / 难用 / 好用 / 清晰 / 繁琐 / 友好 / 反人类 / 完美 / 垃圾 / 精美 / 简陋 / 专业 / 业余`
**豁免**：`inner_voice`（心声）与 `i_thought`（当时以为）允许出现情绪词，因为那是**当下的即时感受**而非事后评价。`opening` 与 `gut_feeling` 同样豁免。
**判定强度**：**抽查，非硬校验**。命中 1–2 处仅提示不打回；命中 ≥3 处才打回。
**打回话术**：
> `ADJECTIVE_LEAK` —— 第 6 步之前出现了评价性形容词：{词 + 位置，逐条列出}。
> 前 5 步只记录**事实**和**当下的即时感受**。"我停下来了 4 分钟"是事实，"这里设计得很糟糕"是评价——后者请挪到 `step6_verdict`。
> 改写这几处即可，不需要重跑任何操作。

### 7.12 `CREDENTIAL_ECHO`
**命中**：返回内容（含 `digest` / `value` / `artifact` 文件名 / 任意文本字段）中出现用户在会话中提供的凭据明文（账号、密码、token、Cookie、API Key）。
**打回话术**：
> `CREDENTIAL_ECHO` —— 你的返回中出现了凭据明文：{脱敏后的位置，如 `step2_main_path[1].evidence.value` 含密码}。
> **立即改为 `***`**，并检查你写进 {evidence_dir} 的文件里有没有同样的泄漏——有就用同样的方式脱敏后重写该文件。
> 凭据不落盘、不入证据、不进报告，这是红线，没有例外。

**主 Agent 侧配套**：命中此码时，除打回外还必须自行扫描 `evidence/{role_id}/` 下所有文件，清理后才能进入合成阶段。交付前 `verify_report.mjs` 的 `credential_leak` 必须为 `false`。

---

## 8. 违规码速查

| 违规码 | 一句话命中条件 | 是否硬校验 | 是否需重跑命令 |
|---|---|---|---|
| `PARSE_FAIL` | 没有唯一合法 JSON 块 | ✓ | 否，重排格式 |
| `MISSING_STEP` | 七步不全 / 预期≠3 / 主路径<3 | ✓ | 视缺失步骤 |
| `EDGE_TOO_FEW` | 边缘尝试 <3 | ✓ | 是，补做 |
| `CURVE_BAD` | 采样点不在 5–8 或缺最低/最高 | ✓ | 否，凭回忆补 |
| `NO_HIGHLIGHT` | 亮点为空 | ✓ | 否，回头找 |
| `EVIDENCE_MISSING` | 结论缺 evidence.level | ✓ | 否，补挂或降级 |
| `RED_NO_REASON` | 有 red 但降级原因为空 | ✓ | 否，补写 |
| `ARTIFACT_DANGLING` | green 的 artifact 文件不存在 | ✓✓ **最重** | 二选一：重跑落盘 或 降级 |
| `FALSE_ENV_EXCUSE` | `cause=env_missing` 但 EnvProbe 显示可用 | ✓ | 否，改判 `budget_exhausted` |
| `FALSE_ACCESS_EXCUSE` | `cause=access_denied` 但 `access_status≠refused` | ✓ | 否，改判 `budget_exhausted` |
| `ADJECTIVE_LEAK` | 第 6 步前出现评价性形容词 | 抽查（≥3 处才打回） | 否，改写 |
| `CREDENTIAL_ECHO` | 返回含凭据明文 | ✓ | 否，脱敏 + 清理落盘文件 |

---

## 9. 二次仍失败的降级处置（不再重试）

打回一次后**不再重试**（成本纪律）。仍不合格时，主 Agent 按下列四条处置，**四条全做，一条不能漏**：

1. **标记**：`experience_completed` 强制置为 `false`。
2. **压级**：该角色所有结论的证据等级**上限压到 `yellow`**（原 green 一律降为 yellow；原 yellow/red 保持）。若命中的是 `ARTIFACT_DANGLING`，同样处理并额外记录 dangling 文件清单。
3. **不计共识**：该角色的观点**不计入 `synthesis-rules.md` 的「≥2 人独立提及」人次统计**；其发现可以出现在《读者来信》版，但不得单独支撑一条共识或 P0。
4. **末版登记**：报告《⚖️ 更正与声明》版逐条写明：
   ```
   - {role_id} {role_name}：体验未完成。命中违规码 {codes}，重试后仍未通过。
     其结论证据等级已整体压至 🟡，不计入共识人次。
     未完成原因：{degradation_reasons 摘要 / 打回原因}
   ```

**若某角色全部结论均为 red**（纯推演，如 ffmpeg 缺失下的 VIDEO 角色）：走同样的第 3、4 条（不计共识 + 末版登记），但 `experience_completed` 可以为 `true`——**没跑成不等于没干活**，前提是 `degradation_reasons` 写全了。这两种情况在末版要分开表述，不要混为一谈。
