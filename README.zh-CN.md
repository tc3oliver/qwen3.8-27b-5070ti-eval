# 在 RTX 5070 Ti 上跑 Qwen3.8-27B：最快的 recipe，质量也是最好的吗？

[English](README.md) | [繁體中文](README.zh-TW.md) | **简体中文**

![Protocol: pre-registered](https://img.shields.io/badge/protocol-pre--registered-2ea44f)
![GPU: RTX 5070 Ti 16 GB](https://img.shields.io/badge/GPU-RTX%205070%20Ti%2016%20GB-76b900)
![Runtime: llama.cpp + recipe v3](https://img.shields.io/badge/runtime-llama.cpp%20%2B%20recipe%20v3-blue)
[![License: Apache-2.0 / CC BY 4.0](https://img.shields.io/badge/license-Apache--2.0%20%7C%20CC%20BY%204.0-lightgrey)](LICENSE-CONTENT.md)

[feveromo recipe](https://github.com/feveromo/recipes-qwen3.8-27b-5070ti) 能把 27B 模型跑在 16 GB 显卡上。
按作者给的数据，同样的权重、真实的 agent session，decode 速度是原版 llama.cpp 的 1.9×
（[C01](EVIDENCE-INDEX.md)）。速度早有定论。这个仓库想搞清楚的是另一件事：只有一张
RTX 5070 Ti，从写代码、agent、中文长文档和延迟几个方面看，它是不是你该跑的模型？想在桌面 GPU 上
把这件事测扎实，又要做哪些工作？

**状态：第 1 轮（2026-10-03）。** 被测模型已经有一次完整、有效的测试结果。第一个对手模型那次因为 VRAM spill
作废了，正在重跑。所以第 1 轮**没有任何对比结论**，只有被测模型自己的测量结果，以及我们在这张卡上学到的测量经验。

<p align="center">
  <img src="results/qwen38-27b-iq3s/pi-2026-10/recording/pi.gif" width="820" alt="RTX 5070 Ti 上的 Qwen3.8-27B 驱动 Pi coding agent，正在写下方的 dashboard">
</p>

<p align="center"><i>本地模型驱动的 <a href="https://github.com/badlogic/pi-mono">Pi</a> coding agent，
用 5 分 20 秒把这次评测的结果做成了 dashboard。评分器事先用参考解法验证过，这个 dashboard 的 20/20 项检查全部通过
（只跑了一次，等级 B，<a href="EVIDENCE-INDEX.md">E30, E31</a>）：</i></p>

<p align="center">
  <img src="results/qwen38-27b-iq3s/pi-2026-10/dashboard-r1/grade-v3/desktop-light.png" width="820" alt="本地模型做出来的 dashboard">
</p>

**视频（51 秒）：**[第 1 轮要点](media/qwen38-5070ti-round1.mp4)，用 TypeScript + three.js 逐帧渲染，画面上每个数字都标了证据编号（[`video/`](video/)）。

<p align="center"><a href="media/qwen38-5070ti-round1.mp4"><img src="media/qwen38-5070ti-round1-poster.png" width="820" alt="Round-1 explainer video"></a></p>

## 主要发现

每条结论都链接到 [`EVIDENCE-INDEX.md`](EVIDENCE-INDEX.md)，从那里能找到原始数据。**A** = 按预注册的协议测得；
**B** = 在这里测的，但不在协议范围内（只作参考，不参与排名）。详见 [`EVIDENCE.md`](EVIDENCE.md)。

1. **只用一张 16 GB 显卡，被测模型的 HumanEval+ 拿到 92.1 %**（151/164，95 % CI 86.9–95.3）。故意埋的 10 个
   bug 全部找出，原因也都说对了；12/12 个工具调用 episode 全部完成，一次格式错误都没有；60K token 的中文文档里
   埋了四个事实，全部召回；日常中文提示词 1.45 s（p50）就开始输出回答。[E01–E07, A]
2. **同一个模型，写代码比写中文快一倍左右。** Decode 速度取决于 speculative decoding 的 draft 接受率：
   HumanEval+ 上接受率中位数是 0.74，decode 155 tok/s；中文讲解和摘要的接受率只有 0.28–0.41，
   decode 74–81 tok/s。recipe 自带的 draft 词表是按英文文本和代码排序的。
   [E09, A — 同一次测试内的相关性]
3. **同一个提示词，temperature 0 也没能复现相同输出。** 用 recipe 的自适应 draft 长度，给刚启动的服务器发同一个
   请求，返回的长度分别是 885、918、1,219、962 和 918 个 token。把 draft 长度固定后，五次都是 3,080 个 token。
   一台已经连续跑了几个小时的服务器（仍是自适应）也给出了一模一样的输出，我们推断它的控制器已经收敛到同一个宽度，
   但宽度没有记日志。两种跑法得出的答案不同（5 和 7）。只测了一个提示词，每种条件跑五次。[E25, B]
4. **“能加载”不等于“能用”。** context 开到 131,072 token 时，被测模型能加载，测试请求的 decode 是
   5.9 tok/s。开到 122,880 时，共享内存计数器显示 485 MiB，decode 只剩 6–8 tok/s；我们认为是 Windows
   驱动把装不下的部分放到了系统 RAM。64K 是还能正常工作的最大设置。有个 MoE 对手模型通过了设置检查，跑到一半
   spill 又涨了，速度在 99 到 27 tok/s 之间大幅波动。那次测试作废、不计入对比（输出保留），harness 现在也改成
   每分钟采样一次 spill。[E21, E23, B]
5. **关于 thinking budget 的初步线索。** 我们在推理题集上做了一轮扫描，每个设置只跑一次（token 预算 4×）。厂商默认的
   effort `xhigh` 用了 25,688 个 token，得 30/40；effort `medium` 加一行 short-think 指令，用了 9,878 个
   token，得 35/40。`xhigh` 有五个答案撞到了 token 上限，而同样的 `medium` 设置在第 1 轮正式测试里得了 33/40。
   所以这里能看出 token 成本，但还证明不了质量孰高孰低。[E24, B]

## 第 1 轮结果（2026-10-03）

| | Qwen3.8-27B IQ3_S + MTP（被测模型） | Ornith-1.5-35B-A3B (MoE) |
|---|---:|---:|
| 证据等级 | **A** | **B** — VRAM spill，结果作废 |
| HumanEval+ pass@1 (164) | **92.1 %** (86.9–95.3) | —（停在 32/164） |
| 10Q 推理，跑 1 次 | 33/40，11,886 tokens | 32/40，57,346 tokens |
| 代码审查（埋了 10 个 bug） | 10/10 | 10/10 |
| Agent 工具调用 | 12/12，0 次格式错误 | 12/12，0 次格式错误 |
| 长 context 召回 16K / 32K / 60K | 4/4 · 4/4 · 4/4 | 4/4 · 4/4 · 4/4 |
| 60K 提示词：prefill、首 token | 1,689 tok/s，39.4 s | 无效 |
| 日常中文提示词：首个回答 token p50 / p90 | 1.45 s / 2.46 s | 无效 |
| Decode，中文文章 / 代码 | 平均 88.5 tok/s（74–106）/ 中位数 155 tok/s | 无效 |

**Coding agent，只跑一次（等级 B）：** Pi 配合被测模型用 320 s 完成了 dashboard 任务：28 轮、27 次工具调用、
0 次工具报错、25,678 个输出 token，评分器检查 20/20（[E30](EVIDENCE-INDEX.md)）。

原始结果：[`results/`](results/) · 汇总表：[`results/arena-2026-10-summary.md`](results/arena-2026-10-summary.md)。
另外四个配置（官方非 abliterated 权重、Unsloth 量化版、Muse-Glimmer-30B、Ornith-1.5-9B）的设置已经冻结，在排队。
Ornith-35B 重跑时会换用它的下一个预注册的设置。设置搜索阶段已经测出：社区默认的 Unsloth UD-Q3_K_XL
（13.15 GB，原版 llama.cpp）在 48K 和 64K 下会 spill 452–484 MiB，只有 32K 能用；recipe 的 IQ3_S
（12.12 GB）则能放下 64K。不过两套配置的差别不止文件大小，质量也没有测。[E20, A]

## 测量方法

- **预注册。** 跑任何对比之前，[`PROTOCOL.md`](PROTOCOL.md) 就已经定好了测试套件、设置搜索方式，以及
  “最佳”怎么定义。之后每次改动或偏离都记在里面并写明原因，作废的测试也都留在仓库里。
- **每个模型用自己的设置。** 每个模型都用自己 model card 上的 sampler 和推理模式。例外是被测模型和它的官方权重
  对照组，这两个用调优过的 effort-`medium` + short-think 设置（见“局限”）。context 大小从一个固定列表里选：从 64K
  开始，取第一个 spill 不超过 300 MiB 就能加载的值，spill 以 Windows 驱动的计数器读数为准。
  Speculative decoding 按各模型自己公开的用法来。所有设置都在跑测试套件之前写进 `frozen.json` 冻结。
- **测试套件。** HumanEval+（164 题全跑，真实执行）、20 道手写的中文推理题（用代码判分）、10 个埋了 bug 的
  代码审查、多轮工具调用（真实执行工具，并做泄漏检测）、在 16K–60K token 的繁体中文维基百科文本里找 needle、
  日常中文提示词的流式延迟，以及一个用浏览器评分器的 coding agent 任务。
- **评分器先验证再使用。** HumanEval+ 检查器能让全部 164 个标准解法通过 [E32]。六个 Python/SQL 埋入的 bug 实际
  跑过都能复现（另外四个 JS/Go/C 的没跑）[E33]。10Q 评分器和之前的人工评分对比过：一次一致，另一次
  有一题（Q8）不同，记录在 `PROTOCOL.md`。Q8 和 Q9 标记为待人工复核，在 33/40 里按未复核状态计分。dashboard
  评分器让参考解法 20/20 通过，也抓出了故意改坏的副本里全部六个缺陷 [E31]。

## 复现

```bash
git clone https://github.com/tc3oliver/qwen3.8-27b-5070ti-eval && cd qwen3.8-27b-5070ti-eval
data/fetch.sh                                   # HumanEval+ (checksum verified)
data/fetch_models.sh ~/models                    # pinned GGUF revisions, SHA-256 verified
# build llama.cpp: the recipe's instructions for the subject, stock master for the others (ENVIRONMENT.md)
python3 harness/run_arena.py --quick qwen38-27b-iq3s   # --quick = round 1's time-boxed subset; omit for the full scope
python3 harness/summarize.py                           # results/<run>-summary.md
```

构建路径在 `harness/run_arena.py` 开头配置。测试期间 runner 会先停掉名为 `llm-chat` 的生产服务，跑完再重新拉起。
如果你的服务名不一样，改一下 `PROD_SERVICE`。

## 局限与已知偏差

- 只有一台机器，Windows 11 + WSL2，桌面也共用这张显卡，所以绝对速度和 context 上限都比纯 Linux 低
  （recipe 作者在纯 Linux 上跑到了 128K [C01，已发表，未重新核验]）。
- 第 1 轮有时间限制：10Q 和代码审查各只跑一次、12 个 agent episode、10 个延迟提示词。HumanEval+ 用生产环境的
  sampler（temperature 1.0）每题只采样一次，不是 greedy。60K 那题用 `max_tokens` 4,967 跑。
- 被测模型的推理设置是在协议定稿前、用 10Q 题集调出来的，所以在 10Q 上对它有利。10Q 的题目是在这台机器上测之前的
  模型时写的。HumanEval+ 可能出现在训练数据里。
- 被测模型的 spill 只在测试前后采样，每分钟一次的监控是后来才加的。
- Pi 跑完之后，dashboard 评分器又收紧了两次（18/18 → 19/19 → 20/20）。TASK.md 把所有 selector 都给了模型，
  所以只有评分器代码是对模型隐藏的。10 个延迟测试的回答里，有 1 个跑成了简体中文。
- Gemma-4-26B-A4B 和 gpt-oss-20b 没有测（不再下载新模型），公开数据可以看候选模型调研。

## 致谢

构建方式、CUDA patch、启动参数和 draft 词表：
[feveromo/recipes-qwen3.8-27b-5070ti](https://github.com/feveromo/recipes-qwen3.8-27b-5070ti)（这里没有再分发）。
权重：[huihui-ai](https://huggingface.co/huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF)、
[ISTA-DASLab](https://huggingface.co/ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF)、[Unsloth](https://huggingface.co/unsloth/Qwen3.8-27B-GGUF)、
[SC117](https://huggingface.co/SC117/Ornith-1.5-35B-A3B-MTP-APEX-GGUF)。Coding agent：[Pi](https://github.com/badlogic/pi-mono)。
Benchmark：[EvalPlus HumanEval+](https://github.com/evalplus/evalplus)。填充文本：中文维基百科（CC BY-SA 4.0）。

## 许可与引用

代码采用 Apache-2.0；文字、结果和手写数据采用 CC BY 4.0（[`LICENSE-CONTENT.md`](LICENSE-CONTENT.md)）。
如果用到这些结果，请引用 [`CITATION.cff`](CITATION.cff)，引用数字时也请一并注明证据等级。
