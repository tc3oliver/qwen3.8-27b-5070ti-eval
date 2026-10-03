# Qwen3.8-27B 跑在 RTX 5070 Ti 上——最快的 recipe，品質也最好嗎？

[English](README.md) | **繁體中文** | [简体中文](README.zh-CN.md)

![Protocol: pre-registered](https://img.shields.io/badge/protocol-pre--registered-2ea44f)
![GPU: RTX 5070 Ti 16 GB](https://img.shields.io/badge/GPU-RTX%205070%20Ti%2016%20GB-76b900)
![Runtime: llama.cpp + recipe v3](https://img.shields.io/badge/runtime-llama.cpp%20%2B%20recipe%20v3-blue)
[![License: Apache-2.0 / CC BY 4.0](https://img.shields.io/badge/license-Apache--2.0%20%7C%20CC%20BY%204.0-lightgrey)](LICENSE-CONTENT.md)

[feveromo recipe](https://github.com/feveromo/recipes-qwen3.8-27b-5070ti) 讓 27B 模型能在 16 GB 顯示卡上執行；
其作者回報，在使用相同權重的真實 agent 工作階段中，decode 速度是原版 llama.cpp 的 1.9×
（[C01](EVIDENCE-INDEX.md)）。速度從來不是懸而未決的問題。本儲存庫問的是另一個問題：在單張
RTX 5070 Ti 上，從程式撰寫、agent、長篇中文文件與延遲來衡量，它是不是你該執行的模型？而要在桌上型 GPU
上誠實地測量這件事，需要做到哪些事？

**狀態：第 1 輪（2026-10-03）。** 受測模型已有一次完整且有效的執行；第一個競爭模型的執行因 VRAM spill（溢出）
被判定無效，正在重跑。因此第 1 輪**不含任何比較性結論**——只有受測模型的測量結果，以及我們在這張卡上學到的測量經驗。

<p align="center">
  <img src="results/qwen38-27b-iq3s/pi-2026-10/recording/pi.gif" width="820" alt="由 RTX 5070 Ti 上的 Qwen3.8-27B 驅動的 Pi coding agent，正在撰寫下方的 dashboard">
</p>

<p align="center"><i>由本機模型驅動的 <a href="https://github.com/badlogic/pi-mono">Pi</a> coding agent，
花 5 分 20 秒建出本研究自身結果的 dashboard；它通過了一個經參考解答驗證過的評分器（grader）的 20/20 項檢查
（單次執行，等級 B — <a href="EVIDENCE-INDEX.md">E30, E31</a>）：</i></p>

<p align="center">
  <img src="results/qwen38-27b-iq3s/pi-2026-10/dashboard-r1/grade-v3/desktop-light.png" width="820" alt="由本機模型建出的 dashboard">
</p>

**影片（51 秒）：**[第 1 輪重點](media/qwen38-5070ti-round1.mp4) — TypeScript + three.js 逐格渲染，畫面上每個數字都標了證據編號（[`video/`](video/)）。

<p align="center"><a href="media/qwen38-5070ti-round1.mp4"><img src="media/qwen38-5070ti-round1-poster.png" width="820" alt="Round-1 explainer video"></a></p>

## 我們的發現

每項結論都引用 [`EVIDENCE-INDEX.md`](EVIDENCE-INDEX.md)，其中指向原始資料。**A** = 在預先註冊（pre-registered）的協定下測量；
**B** = 在本研究中、但於協定之外測量（僅作背景參考，不用於排名）——詳見 [`EVIDENCE.md`](EVIDENCE.md)。

1. **在單張 16 GB 顯示卡上，受測模型在 HumanEval+ 拿到 92.1 %**（151/164，95 % CI 86.9–95.3），找出全部 10 個
   預先埋入的 bug 且指出正確原因，完成 12/12 個工具呼叫（tool calling）episode 且沒有任何格式錯誤的呼叫，在一份
   60K token 的中文文件中召回全部四個埋入的事實，並在 1.45 s（p50）後開始回答日常中文提示。[E01–E07, A]
2. **同一個模型寫程式碼的速度，大約是寫中文文章的兩倍。** Decode 速度取決於 speculative decoding（推測解碼）的
   draft 有多少被接受：在 HumanEval+ 上，draft acceptance 中位數為 0.74，decode 為 155 tok/s；在中文解說與摘要上，
   acceptance 為 0.28–0.41，decode 為 74–81 tok/s。recipe 隨附的 draft 詞彙表是依英文文本與程式碼排序的。
   [E09, A — 單次執行內的相關性]
3. **在一個提示上，temperature 0 並未重現相同輸出。** 使用 recipe 的自適應 draft 長度時，對剛啟動的伺服器送出
   相同請求，回傳了 885、918、1,219、962 與 918 個 token。改為固定 draft 長度後，五次中五次都是 3,080 個 token；
   而一台已持續執行數小時的伺服器（仍為自適應）也給出了完全相同的輸出——我們推斷它的控制器已收斂到相同的寬度；
   寬度並未記錄。兩條路徑得出不同的答案（5 與 7）。一個提示，每種條件執行五次。[E25, B]
4. **「載入成功」不等於「能用」。** 在 131,072 token 的 context 下，受測模型可以載入，並以 5.9 tok/s 完成一個測試
   請求的 decode；在 122,880 時，共享記憶體計數器讀數為 485 MiB，decode 為 6–8 tok/s，我們將其歸因於 Windows
   驅動程式把溢出部分放進了系統 RAM。64K 是最大的健康設定。一個 MoE 競爭模型通過了設定檢查，卻在執行途中進一步
   spill，速度在 99 與 27 tok/s 之間擺盪；該次執行被判定無效並排除於比較之外（輸出保留），harness 現在每分鐘取樣
   一次 spill。[E21, E23, B]
5. **關於思考預算（thinking budget）的初步跡象。** 在我們推理題組上的單次執行掃描（4× token 預算）中，廠商預設
   的 effort `xhigh` 用了 25,688 個 token、得分 30/40；effort `medium` 加上一行 short-think 指示用了 9,878 個
   token、得分 35/40。有五個 `xhigh` 答案觸及 token 上限，而同樣的 `medium` 設定在第 1 輪的執行中得分 33/40——
   這呈現的是 token 成本，而不是經證實的品質排名。[E24, B]

## 第 1 輪結果（2026-10-03）

| | Qwen3.8-27B IQ3_S + MTP（受測模型） | Ornith-1.5-35B-A3B (MoE) |
|---|---:|---:|
| 證據等級 | **A** | **B** — 執行因 VRAM spill 判定無效 |
| HumanEval+ pass@1 (164) | **92.1 %** (86.9–95.3) | —（停在 32/164） |
| 10Q 推理，1 次執行 | 33/40，11,886 tokens | 32/40，57,346 tokens |
| 程式碼審查（10 個埋入的 bug） | 10/10 | 10/10 |
| Agent 工具呼叫 | 12/12，0 個格式錯誤 | 12/12，0 個格式錯誤 |
| 長 context 召回 16K / 32K / 60K | 4/4 · 4/4 · 4/4 | 4/4 · 4/4 · 4/4 |
| 60K 提示：prefill、首個 token | 1,689 tok/s，39.4 s | 無效 |
| 日常中文提示：首個回答 token p50 / p90 | 1.45 s / 2.46 s | 無效 |
| Decode，中文文章 / 程式碼 | 平均 88.5 tok/s（74–106）/ 中位數 155 tok/s | 無效 |

**Coding agent，單次執行（等級 B）：** Pi + 受測模型在 320 s 內完成 dashboard 任務——28 個回合、27 次工具呼叫、
0 次工具錯誤、25,678 個輸出 token、20/20 項評分器檢查（[E30](EVIDENCE-INDEX.md)）。

原始結果：[`results/`](results/) · 彙整表：[`results/arena-2026-10-summary.md`](results/arena-2026-10-summary.md)。
另外四個組態（官方非 abliterated 權重、Unsloth 量化版、Muse-Glimmer-30B、Ornith-1.5-9B）的設定已凍結，正在排隊；
Ornith-35B 的重跑將使用其下一個預先註冊的設定。在設定搜尋中已經測得：社群預設的 Unsloth UD-Q3_K_XL
（13.15 GB，原版 llama.cpp）在 48K 與 64K 時 spill 了 452–484 MiB，只有在 32K 時可用；而 recipe 的 IQ3_S
（12.12 GB）可容納 64K。檔案大小只是兩套設定之間的多項差異之一，且品質並未測量。[E20, A]

## 測量方法

- **預先註冊。** [`PROTOCOL.md`](PROTOCOL.md) 在任何比較執行之前，就固定了測試套件（suite）、設定搜尋方式以及
  「最佳」的定義；之後的每一項變更與偏離都連同理由記錄在其中，無效的執行也保留在儲存庫裡。
- **每個模型各自的設定。** 每個模型都使用其 model card 的取樣器（sampler）與推理模式——受測模型及其官方權重
  對照組除外，兩者使用調整過的 effort-`medium` + short-think 設定（見「限制」）——並使用固定清單中、從 64K 起
  第一個能在 spill 不超過 300 MiB（以 Windows 驅動程式計數器讀數為準）的情況下載入的 context 大小。
  Speculative decoding 依照每個模型自己公開的用法。設定在執行測試套件前凍結於 `frozen.json`。
- **測試套件。** HumanEval+（全部 164 題，實際執行）、20 題手寫的中文推理題（以程式評分）、10 個埋入 bug 的
  程式碼審查、具真實工具執行與洩漏偵測的多輪工具呼叫、在 16K–60K token 繁體中文維基百科文本中的 needle 召回、
  日常中文提示的串流延遲，以及一項使用瀏覽器評分器的 coding agent 任務。
- **評分器先經測試才採信。** HumanEval+ 檢查器通過全部 164 個標準解答 [E32]；六個 Python/SQL 埋入 bug 在
  實際執行時可重現（四個 JS/Go/C 的並未執行）[E33]；10Q 評分器在一次執行上與先前的人工評分一致，在另一次執行上
  有一題（Q8）不同，已記錄於 `PROTOCOL.md`——Q8 與 Q9 被標記為待人工審查，並以未審查狀態計入 33/40；dashboard
  評分器讓參考解答以 20/20 通過，並抓出在一份損壞副本中埋入的全部六個缺陷 [E31]。

## 重現

```bash
git clone https://github.com/tc3oliver/qwen3.8-27b-5070ti-eval && cd qwen3.8-27b-5070ti-eval
data/fetch.sh                                   # HumanEval+ (checksum verified)
data/fetch_models.sh ~/models                    # pinned GGUF revisions, SHA-256 verified
# build llama.cpp: the recipe's instructions for the subject, stock master for the others (ENVIRONMENT.md)
python3 harness/run_arena.py --quick qwen38-27b-iq3s   # --quick = round 1's time-boxed subset; omit for the full scope
python3 harness/summarize.py                           # results/<run>-summary.md
```

建置路徑設定在 `harness/run_arena.py` 開頭。執行器在執行期間會停止名為 `llm-chat` 的正式環境服務，結束後再重新
啟動——若你的服務名稱不同，請修改 `PROD_SERVICE`。

## 限制與已知偏差

- 單一機器，Windows 11 + WSL2，且桌面與運算共用同一張顯示卡：絕對速度與 context 上限都低於純 Linux 環境
  （recipe 作者在純 Linux 上達到 128K [C01，已發表，未重新驗證]）。
- 第 1 輪有時間限制：10Q 與程式碼審查各只執行一次、12 個 agent episode、10 個延遲提示；HumanEval+ 在正式環境的
  取樣器設定（temperature 1.0）下每題只取樣一次，而非 greedy；60K 項目以 `max_tokens` 4,967 執行。
- 受測模型的推理設定在協定制定之前就已在 10Q 題組上調整過，這在 10Q 上對它有利；10Q 題目是在這台機器上測試
  先前模型時撰寫的；HumanEval+ 可能出現在訓練資料中。
- 受測模型的 spill 只在其執行前後取樣；每分鐘一次的監控是之後才加入的。
- Dashboard 評分器在 Pi 執行之後收緊了兩次（18/18 → 19/19 → 20/20）；TASK.md 提供了模型所有 selector，因此
  只有評分器程式碼是對模型隱藏的。10 個延遲測試回答中有 1 個偏移成簡體中文。
- Gemma-4-26B-A4B 與 gpt-oss-20b 未經測量（不再進行額外下載）；公開發表的數據見候選模型調查（candidate survey）。

## 致謝

建置、CUDA 修補、啟動旗標與 draft 詞彙表：
[feveromo/recipes-qwen3.8-27b-5070ti](https://github.com/feveromo/recipes-qwen3.8-27b-5070ti)（未在此重新散布）。
權重：[huihui-ai](https://huggingface.co/huihui-ai/Huihui-Qwen3.8-27B-abliterated-GGUF)、
[ISTA-DASLab](https://huggingface.co/ISTA-DASLab/Qwen3.8-27B-GSQ-RCO-GGUF)、[Unsloth](https://huggingface.co/unsloth/Qwen3.8-27B-GGUF)、
[SC117](https://huggingface.co/SC117/Ornith-1.5-35B-A3B-MTP-APEX-GGUF)。Coding agent：[Pi](https://github.com/badlogic/pi-mono)。
Benchmark：[EvalPlus HumanEval+](https://github.com/evalplus/evalplus)。填充文本：中文維基百科（CC BY-SA 4.0）。

## 授權與引用

程式碼採用 Apache-2.0；文字、結果與手寫資料採用 CC BY 4.0（[`LICENSE-CONTENT.md`](LICENSE-CONTENT.md)）。
若你使用這些結果，請引用 [`CITATION.cff`](CITATION.cff)，並在引用數字時一併附上其證據等級。
