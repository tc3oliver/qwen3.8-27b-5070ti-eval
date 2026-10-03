# 素材簡報：Qwen3.8-27B × RTX 5070 Ti 第 1 輪

給負責成果最大化的 agent 讀。這份簡報整理了研究的來龍去脈、可用的亮點和絕對不能說的話；**數字一律以 `EVIDENCE-INDEX.md` 為準**。若這份簡報和 `EVIDENCE-INDEX.md` 不一致，以後者為準。

## 一句話

一張 16 GB 的 RTX 5070 Ti 能把 27B 模型跑到可用：HumanEval+ 92.1 %、寫程式 155 tok/s。這份研究公開了預先登錄的協議、原始數據和評分器，也記錄了在桌機 GPU 上量測時會踩到的坑。

## 故事線（2026-10-03，一天之內）

1. **起點**：家裡的 RTX 5070 Ti 跑本機模型服務。社群出現 feveromo 的 recipe，用 IQ3_S 量化加 MTP 推測解碼，把 Qwen3.8-27B 塞進 16 GB，作者實測比原版 llama.cpp 快 1.9 倍（C01，作者數據，未重測）。速度不是問題，問題是：它真的是這張卡上該跑的模型嗎？
2. **第一個坑：載得進去 ≠ 跑得動**（E23）。目標是 128K context，結果載得起來，但解碼只剩 5.9 tok/s。原因是 Windows 桌面約佔 3.5 GB 顯示記憶體，WSL2 的驅動會把放不下的部分悄悄放到系統記憶體，而且不會報錯。最後選 64K：86–92 tok/s，共享記憶體 169 MiB。
3. **第二個坑：想太多**（E24，B 級）。官方預設的思考強度 `xhigh` 很耗 token，舊紀錄裡有一題 12 個字的造句想了 13,852 tok（見 `backstory/`）。換成 `medium` 加一行「想短一點」的指示後，token 只用 38 %，分數反而從 30/40 升到 35/40。不過這只跑了一次，不能當成品質排名。這個設定後來成了正式服務的預設。
4. **做成研究**：開了公開 repo，先寫好 `PROTOCOL.md`，把要比什麼、怎麼挑設定、什麼叫「最好」都定下來，然後才跑。
5. **誠信時刻**（E21）：第一個競爭模型 Ornith-35B 通過了設定檢查，跑到一半卻開始溢出，速度在 99 和 27 tok/s 之間跳動。那一輪被宣告作廢，輸出保留在 repo 裡，harness 也加上每分鐘監測溢出。**所以第 1 輪沒有任何比較結論。**
6. **Pi agent 實戰**（E30、E31，B 級）：本機模型驅動 Pi coding agent，從空資料夾做出一個儀表板，花了 5 分 20 秒，28 回合，0 次工具錯誤，瀏覽器檢查 20/20。評分器事後收緊過兩次（18 → 19 → 20 項），這點有公開揭露；評分器也用參考解和故意寫壞的版本驗證過。
7. **自我修正**（E25）：事實核對時發現我自己先前寫錯了。原本說 temperature 0 不可重現是 MTP 造成的，做了對照實驗後才確定，真正的原因是 adaptive draft length：固定草稿長度時 5 次結果完全一致，adaptive 時每次都不同，兩條路徑連答案都不一樣（5 vs 7）。README 和文件已公開更正。
8. **意外發現**（E09）：寫程式約是寫中文的兩倍快，155 vs 74–81 tok/s。原因是 MTP 的草稿接受率不同（0.74 vs 0.28–0.41），而 recipe 附的草稿詞表是依英文和程式碼排序的。這對中文使用者是有用的資訊，也可以回饋給上游。
9. **影片**：用 TypeScript 加 three.js 寫的 51 秒影片，逐格渲染，配樂也是用程式合成的原創曲。畫面上每個數字都標了證據編號。

## 可引用的亮點（附 ID）

| 亮點 | 值 | ID / 等級 |
|---|---|---|
| HumanEval+ | 92.1 %（151/164，95 % CI 86.9–95.3） | E01 · A |
| 程式碼審查 | 10 個植入的 bug 全部找到，行號與原因都對 | E03 · A |
| 工具呼叫 | 12/12，0 次格式錯誤 | E04 · A |
| 中文長文 | 60K tokens 裡埋的 4 個事實全部找回 | E05 · A |
| 首字延遲 | p50 1.45 s | E07 · A |
| 程式碼 vs 中文速度 | 155 vs 74–81 tok/s | E09 · A（同輪相關性） |
| 64K vs 128K | 86–92 vs 5.9 tok/s | E23 · B |
| 思考強度 | 35/40 用 9,878 tok，vs xhigh 30/40 用 25,688 tok | E24 · B（初步，單次） |
| temp 0 可重現性 | adaptive 885–1,219 tok 不定；固定長度 3,080 tok ×5 | E25 · B |
| Pi agent | 320 s，20/20 | E30、E31 · B |
| recipe 作者數據 | 1.9×、147.2 tok/s、128K 在裸機 Linux | C01 · C（非本研究量測） |

## 絕對不能說

- 「5070 Ti 最強／最佳模型」，或任何「比 X 好」的說法。第 1 輪沒有有效的比較數據。
- 把 B 級的數字講成定論，或把 C01 的數字講成我們量到的。
- `backstory/` 裡的舊分數（qwythos、Qwen3.5-9B、IQ2_M、Ornith-9B 等）。那些是協議之前的內部紀錄，不在證據索引裡，**只能當故事背景**，不能當數據引用；要用，也只能寫「早期內部測試」這類定性描述。
- Ornith-35B 那輪作廢的數據（E22 的 32/40、57,346 tok）可以當「我們為什麼作廢」的故事素材，但不能拿來比較。

## 素材位置（都在這個分支）

| 素材 | 路徑 |
|---|---|
| 影片 51 秒 1080p（有配樂） | `media/qwen38-5070ti-round1.mp4` |
| 影片封面 | `media/qwen38-5070ti-round1-poster.png` |
| 影片截圖 10 張 | `outreach/stills/video-XXs.png`（檔名是秒數） |
| 6 秒 GIF（155 tok/s 那段） | `outreach/clip-speed-6s.gif` |
| GitHub social preview（1280×640） | `outreach/social-preview-1280x640.png` |
| Pi agent 終端錄影 | `results/qwen38-27b-iq3s/pi-2026-10/recording/pi.gif`、`pi.cast` |
| Pi 做出的儀表板截圖（亮、暗、手機、tooltip） | `results/qwen38-27b-iq3s/pi-2026-10/dashboard-r1/grade-v3/*.png` |
| Pi 做出的儀表板原始碼（可直接開） | `results/qwen38-27b-iq3s/pi-2026-10/dashboard-r1/work/` |
| context 掃描、思考強度實驗 | `results/qwen38-27b-iq3s/2026-10-03-prelim/`（`effort-sweep.md`、`ctx-sweep/summary.txt`） |
| 可重現性實驗 | `results/qwen38-27b-iq3s/determinism-2026-10/README.md` |
| 作廢那一輪 | `results/ornith-1.5-35b-a3b-apex/arena-2026-10/invalid-spill-1/INVALID.md` |
| 競爭模型調查 | `reports/candidate-survey.md` |
| 早期內部測試紀錄（只當背景） | `outreach/backstory/EVAL_RESULTS*.md` |
| 影片原始碼與分段表 | `video/`、`video/README.md` |
