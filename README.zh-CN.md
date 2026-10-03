# Qwen3.8-27B 跑在 RTX 5070 Ti 上——最快的 recipe，质量也最好吗？

[English](README.md) | [繁體中文](README.zh-TW.md) | **简体中文**

![Protocol: pre-registered](https://img.shields.io/badge/protocol-pre--registered-2ea44f)
![GPU: RTX 5070 Ti 16 GB](https://img.shields.io/badge/GPU-RTX%205070%20Ti%2016%20GB-76b900)
![Runtime: llama.cpp + recipe v3](https://img.shields.io/badge/runtime-llama.cpp%20%2B%20recipe%20v3-blue)
[![License: Apache-2.0 / CC BY 4.0](https://img.shields.io/badge/license-Apache--2.0%20%7C%20CC%20BY%204.0-lightgrey)](LICENSE-CONTENT.md)

[feveromo recipe](https://github.com/feveromo/recipes-qwen3.8-27b-5070ti) 让 27B 模型能在 16 GB 显卡上运行；
其作者报告，在使用相同权重的真实 agent 会话中，decode 速度是原版 llama.cpp 的 1.9×
（[C01](EVIDENCE-INDEX.md)）。速度从来不是悬而未决的问题。本仓库关心的是另一个问题：在单张
RTX 5070 Ti 上，从代码编写、agent、长篇中文文档和延迟来衡量，它是不是你应该运行的模型？而要在桌面 GPU
上诚实地测量这件事，需要做到哪些？

**状态：第 1 轮（2026-10-03）。** 受测模型已有一次完整且有效的运行；第一个竞争模型的运行因 VRAM spill（溢出）
被判定无效，正在重跑。因此第 1 轮**不包含任何比较性结论**——只有受测模型的测量结果，以及我们在这张卡上学到的测量经验。

<p align="center">
  <img src="results/qwen38-27b-iq3s/pi-2026-10/recording/pi.gif" width="820" alt="由 RTX 5070 Ti 上的 Qwen3.8-27B 驱动的 Pi coding agent，正在编写下方的 dashboard">
</p>

<p align="center"><i>由本地模型驱动的 <a href="https://github.com/badlogic/pi-mono">Pi</a> coding agent，
用 5 分 20 秒搭建出本研究自身结果的 dashboard；它通过了一个经参考解法验证过的评分器（grader）的 20/20 项检查
（单次运行，等级 B — <a href="EVIDENCE-INDEX.md">E30, E31</a>）：</i></p>

<p align="center">
  <img src="results/qwen38-27b-iq3s/pi-2026-10/dashboard-r1/grade-v3/desktop-light.png" width="820" alt="由本地模型搭建的 dashboard">
</p>

**视频（51 秒）：**[第 1 轮要点](media/qwen38-5070ti-round1.mp4) — TypeScript + three.js 逐帧渲染，画面上每个数字都标了证据编号（[`video/`](video/)）。

<p align="center"><a href="media/qwen38-5070ti-round1.mp4"><img src="media/qwen38-5070ti-round1-poster.png" width="820" alt="Round-1 explainer video"></a></p>

## 我们的发现

每条结论都引用 [`EVIDENCE-INDEX.md`](EVIDENCE-INDEX.md)，其中指向原始数据。**A** = 在预先注册（pre-registered）的协议下测量；
**B** = 在本研究中、但在协议之外测量（仅作背景参考，不用于排名）——详见 [`EVIDENCE.md`](EVIDENCE.md)。

1. **在单张 16 GB 显卡上，受测模型在 HumanEval+ 上取得 92.1 %**（151/164，95 % CI 86.9–95.3），找出全部 10 个
   预先埋入的 bug 并指出正确原因，完成 12/12 个工具调用（tool calling）episode 且没有任何格式错误的调用，在一份
   60K token 的中文文档中召回全部四个埋入的事实，并在 1.45 s（p50）后开始回答日常中文提示。[E01–E07, A]
2. **同一个模型写代码的速度，大约是写中文文章的两倍。** Decode 速度取决于 speculative decoding（推测解码）的
   draft 有多少被接受：在 HumanEval+ 上，draft acceptance 中位数为 0.74，decode 为 155 tok/s；在中文讲解和摘要上，
   acceptance 为 0.28–0.41，decode 为 74–81 tok/s。recipe 自带的 draft 词表是按英文文本和代码排序的。
   [E09, A — 单次运行内的相关性]
3. **在一个提示上，temperature 0 没有复现相同输出。** 使用 recipe 的自适应 draft 长度时，向刚启动的服务器发送
   相同请求，返回了 885、918、1,219、962 和 918 个 token。改为固定 draft 长度后，五次中五次都是 3,080 个 token；
   而一台已经持续运行数小时的服务器（仍为自适应）也给出了完全相同的输出——我们推断它的控制器已收敛到相同的宽度；
   宽度没有记录。两条路径得出了不同的答案（5 和 7）。一个提示，每种条件运行五次。[E25, B]
4. **“加载成功”不等于“能用”。** 在 131,072 token 的 context 下，受测模型可以加载，并以 5.9 tok/s 完成一个测试
   请求的 decode；在 122,880 时，共享内存计数器读数为 485 MiB，decode 为 6–8 tok/s，我们将其归因于 Windows
   驱动把溢出部分放进了系统 RAM。64K 是最大的健康设置。一个 MoE 竞争模型通过了设置检查，却在运行途中进一步
   spill，速度在 99 和 27 tok/s 之间摆动；该次运行被判定无效并排除在比较之外（输出保留），harness 现在每分钟采样
   一次 spill。[E21, E23, B]
5. **关于思考预算（thinking budget）的初步迹象。** 在我们推理题集上的单次运行扫描（4× token 预算）中，厂商默认
   的 effort `xhigh` 用了 25,688 个 token、得分 30/40；effort `medium` 加上一行 short-think 指令用了 9,878 个
   token、得分 35/40。有五个 `xhigh` 答案触及 token 上限，而同样的 `medium` 设置在第 1 轮的运行中得分 33/40——
   这体现的是 token 成本，而不是经过证实的质量排名。[E24, B]

## 第 1 轮结果（2026-10-03）

| | Qwen3.8-27B IQ3_S + MTP（受测模型） | Ornith-1.5-35B-A3B (MoE) |
|---|---:|---:|
| 证据等级 | **A** | **B** — 运行因 VRAM spill 判定无效 |
| HumanEval+ pass@1 (164) | **92.1 %** (86.9–95.3) | —（停在 32/164） |
| 10Q 推理，1 次运行 | 33/40，11,886 tokens | 32/40，57,346 tokens |
| 代码审查（10 个埋入的 bug） | 10/10 | 10/10 |
| Agent 工具调用 | 12/12，0 个格式错误 | 12/12，0 个格式错误 |
| 长 context 召回 16K / 32K / 60K | 4/4 · 4/4 · 4/4 | 4/4 · 4/4 · 4/4 |
| 60K 提示：prefill、首个 token | 1,689 tok/s，39.4 s | 无效 |
| 日常中文提示：首个回答 token p50 / p90 | 1.45 s / 2.46 s | 无效 |
| Decode，中文文章 / 代码 | 平均 88.5 tok/s（74–106）/ 中位数 155 tok/s | 无效 |

**Coding agent，单次运行（等级 B）：** Pi + 受测模型在 320 s 内完成 dashboard 任务——28 轮对话、27 次工具调用、
0 次工具错误、25,678 个输出 token、20/20 项评分器检查（[E30](EVIDENCE-INDEX.md)）。

原始结果：[`results/`](results/) · 汇总表：[`results/arena-2026-10-summary.md`](results/arena-2026-10-summary.md)。
另外四个配置（官方非 abliterated 权重、Unsloth 量化版、Muse-Glimmer-30B、Ornith-1.5-9B）的设置已冻结，正在排队；
Ornith-35B 的重跑将使用其下一个预先注册的设置。在设置搜索中已经测得：社区默认的 Unsloth UD-Q3_K_XL
（13.15 GB，原版 llama.cpp）在 48K 和 64K 时 spill 了 452–484 MiB，只有在 32K 时可用；而 recipe 的 IQ3_S
（12.12 GB）可以容纳 64K。文件大小只是两套配置之间的多项差异之一，且质量没有测量。[E20, A]

## 测量方法

- **预先注册。** [`PROTOCOL.md`](PROTOCOL.md) 在任何比较运行之前，就固定了测试套件（suite）、设置搜索方式以及
  “最佳”的定义；之后的每一项变更和偏离都连同理由记录在其中，无效的运行也保留在仓库里。
- **每个模型各自的设置。** 每个模型都使用其 model card 的采样器（sampler）和推理模式——受测模型及其官方权重
  对照组除外，两者使用调优过的 effort-`medium` + short-think 设置（见“局限”）——并使用固定列表中、从 64K 起
  第一个能在 spill 不超过 300 MiB（以 Windows 驱动计数器读数为准）的情况下加载的 context 大小。
  Speculative decoding 遵循每个模型自己公开的用法。设置在运行测试套件前冻结于 `frozen.json`。
- **测试套件。** HumanEval+（全部 164 题，实际执行）、20 道手写的中文推理题（由代码评分）、10 个埋入 bug 的
  代码审查、带真实工具执行和泄漏检测的多轮工具调用、在 16K–60K token 繁体中文维基百科文本中的 needle 召回、
  日常中文提示的流式延迟，以及一项使用浏览器评分器的 coding agent 任务。
- **评分器先经测试再采信。** HumanEval+ 检查器通过全部 164 个标准解法 [E32]；六个 Python/SQL 埋入 bug 在
  实际运行时可以复现（四个 JS/Go/C 的没有运行）[E33]；10Q 评分器在一次运行上与先前的人工评分一致，在另一次运行上
  有一题（Q8）不同，已记录于 `PROTOCOL.md`——Q8 和 Q9 被标记为待人工复核，并以未复核状态计入 33/40；dashboard
  评分器让参考解法以 20/20 通过，并抓出了在一份损坏副本中埋入的全部六个缺陷 [E31]。

## 复现

```bash
git clone https://github.com/tc3oliver/qwen3.8-27b-5070ti-eval && cd qwen3.8-27b-5070ti-eval
data/fetch.sh                                   # HumanEval+ (checksum verified)
data/fetch_models.sh ~/models                    # pinned GGUF revisions, SHA-256 verified
# build llama.cpp: the recipe's instructions for the subject, stock master for the others (ENVIRONMENT.md)
python3 harness/run_arena.py --quick qwen38-27b-iq3s   # --quick = round 1's time-boxed subset; omit for the full scope
python3 harness/summarize.py                           # results/<run>-summary.md
```

构建路径设置在 `harness/run_arena.py` 开头。运行器在运行期间会停止名为 `llm-chat` 的生产服务，结束后再重新
启动——如果你的服务名不同，请修改 `PROD_SERVICE`。

## 局限与已知偏差

- 单台机器，Windows 11 + WSL2，且桌面与计算共用同一张显卡：绝对速度和 context 上限都低于纯 Linux 环境
  （recipe 作者在纯 Linux 上达到 128K [C01，已发布，未重新核验]）。
- 第 1 轮有时间限制：10Q 和代码审查各只运行一次、12 个 agent episode、10 个延迟提示；HumanEval+ 在生产环境的
  采样器设置（temperature 1.0）下每题只采样一次，而非 greedy；60K 项目以 `max_tokens` 4,967 运行。
- 受测模型的推理设置在协议制定之前就已在 10Q 题集上调优过，这在 10Q 上对它有利；10Q 题目是在这台机器上测试
  先前模型时编写的；HumanEval+ 可能出现在训练数据中。
- 受测模型的 spill 只在其运行前后采样；每分钟一次的监控是之后才加入的。
- Dashboard 评分器在 Pi 运行之后收紧了两次（18/18 → 19/19 → 20/20）；TASK.md 向模型提供了所有 selector，因此
  只有评分器代码是对模型隐藏的。10 个延迟测试回答中有 1 个漂移成了简体中文。
- Gemma-4-26B-A4B 和 gpt-oss-20b 没有测量（不再进行额外下载）；公开发布的数据见候选模型调研（candidate survey）。

## 致谢

构建、CUDA 补丁、启动参数和 draft 词表：
[feveromo/recipes-qwen3.8-27b-5070ti](https://github.com/feveromo/recipes-qwen3.8-27b-5070ti)（未在此再分发）。
权重：[huihui-ai](https://huggingface.co/huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF)、
[ISTA-DASLab](https://huggingface.co/ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF)、[Unsloth](https://huggingface.co/unsloth/Qwen3.8-27B-GGUF)、
[SC117](https://huggingface.co/SC117/Ornith-1.5-35B-A3B-MTP-APEX-GGUF)。Coding agent：[Pi](https://github.com/badlogic/pi-mono)。
Benchmark：[EvalPlus HumanEval+](https://github.com/evalplus/evalplus)。填充文本：中文维基百科（CC BY-SA 4.0）。

## 许可与引用

代码采用 Apache-2.0；文字、结果和手写数据采用 CC BY 4.0（[`LICENSE-CONTENT.md`](LICENSE-CONTENT.md)）。
如果你使用这些结果，请引用 [`CITATION.cff`](CITATION.cff)，并在引用数字时一并注明其证据等级。
