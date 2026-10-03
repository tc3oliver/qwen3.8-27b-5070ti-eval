# 任務：Qwen3.8-27B × RTX 5070 Ti 研究成果最大化

你負責把一份已公開的開源研究，包裝並發佈到我的三個平台上，讓它的影響力最大，同時不損及可信度。這份研究的賣點是「誠實的量測方法」，任何誇大都會毀掉它，所以**可信度優先於聲量**。

這台電腦沒有原本的實驗環境：沒有 GPU 服務、模型或 harness 執行環境。所有素材都在 GitHub 的一個分支上。

## 第 0 步：取得素材

```bash
git clone -b outreach-kit https://github.com/tc3oliver/qwen3.8-27b-5070ti-eval.git qwen38-outreach
cd qwen38-outreach
```

依序讀：

1. `outreach/BRIEF.md`：故事線、可引用的亮點、絕對不能說的話、每個素材在哪裡。**先讀這份。**
2. `EVIDENCE-INDEX.md`：唯一可以引用的數字來源。
3. `README.md`（英文）與 `README.zh-TW.md`；`PROTOCOL.md` 讀前兩節就好。
4. `video/README.md`：影片的分段表，寫文章時可以對照時間點。

`outreach-kit` 是暫時的素材分支，內容 = `main` + `outreach/` 資料夾。對外連結一律指向 `main`，例如 `https://github.com/tc3oliver/qwen3.8-27b-5070ti-eval`，**不要連到 `outreach-kit`**，因為它之後會被刪除。

## 我的平台

- GitHub：https://github.com/tc3oliver（研究 repo 是 `tc3oliver/qwen3.8-27b-5070ti-eval`）
- 技術部落格：https://study.meowcoder.com/
- 個人網站：https://meowcoder.com/
- 我 GitHub 上有一個 DeepSeek on MI300X 的研究 repo，可以參考它和網站上對應的呈現方式。

## 鐵則（違反任何一條都算失敗）

1. **數字只能來自 `EVIDENCE-INDEX.md`**：照寫的值引用並帶上等級。B 級要讓讀者看得出是「單次／參考」性質，C 級要寫明是別人量的。表上沒有的數字不能用；`outreach/backstory/` 的舊分數只能當故事背景。
2. **不能宣稱或暗示「5070 Ti 上最好的模型」或「比 X 好」**：第 1 輪沒有有效的比較數據。可以寫「第 1 輪：受測模型的實測」「模型比較在下一輪」。
3. **對外動作一律先給我看、等我批准**：推送部落格或網站 repo、改研究 repo、發 GitHub release、改 profile、設 social preview、開 issue、發社群貼文都算。草稿可以自由寫在本機。
4. **不准公開私人資訊**：API 金鑰、家目錄路徑、內網 IP、Windows 使用者名稱。素材裡已經清過，你新寫的東西也不能加進去。
5. **不做新的量測，也不編數字**：這台電腦沒有實驗環境，缺數據就寫「下一輪」。
6. **git**：
   - commit 身分用 `Oliver Yu <tc3oliver@gmail.com>`，訊息**不得**加任何 `Co-Authored-By: Claude` 之類的署名。
   - 研究 repo 原則上不改；若需要改，例如在 README 加部落格連結，先問我。
   - 不要刪 `outreach-kit` 分支，全部做完時提醒我刪。
7. **語言**：部落格與網站用繁體中文（台灣用語）；英文貼文用自然的英文。避免 AI 腔，例如空泛形容詞、「讓我們一起…」、滿滿的 emoji、每段都用條列。

## 第 1 步：先調查，回報計畫

- 找出 study.meowcoder.com 和 meowcoder.com 的原始碼：這台電腦上的資料夾，或我 GitHub 上的 repo。弄清楚框架（例如 Hugo）、文章或卡片的格式與 front matter、圖片和影片怎麼放、怎麼部署。**找不到就問我，不要猜。**
- 讀 2–3 篇我既有的文章和網站上的專案卡片，抓出我的寫作語氣、結構和標籤慣例。
- 看 DeepSeek MI300X repo 的 README 和它在網站上的呈現方式。
- 看我的 GitHub profile 現況：profile README、pinned repos。

回報一份計畫：每個平台要產出什麼、放在哪個檔案、用哪些素材、預計怎麼部署。**等我同意再開始寫。**

## 第 2 步：產出（全部先做成本機草稿）

1. **部落格長文**（study.meowcoder.com，繁中）
   - 照 `BRIEF.md` 的故事線，用第一人稱調查式敘事：問題 → 兩個坑（載得進去 ≠ 跑得動、想太多）→ 怎麼量才誠實（預先登錄、作廢那一輪）→ 發現 → 自我修正 → 限制 → 下一輪。
   - 必含：
     - 嵌入影片：把 MP4 和封面複製到文章旁邊，用相對路徑和 `<video controls muted playsinline poster=…>`。
     - Pi GIF 或儀表板截圖。
     - 一張重點數據表，附證據 ID 和等級。
     - 「已知限制」段落。
     - repo 連結與引用方式（`CITATION.cff`）。
   - 附 SEO：title、description、slug、tags，OG 圖用 `media/qwen38-5070ti-round1-poster.png`。
2. **meowcoder.com 研究卡片或專案頁**：一句話價值主張、3 個關鍵數字、封面或影片，連到 repo 與文章。
3. **GitHub**
   - profile README 的修改草稿與 pin 建議。
   - 研究 repo 的 social preview：用 `outreach/social-preview-1280x640.png`，這需要我在網頁上手動設定，寫清楚步驟。
   - `v0.1-round1` 的 release notes 草稿。
   - 檢查研究 repo 的 About 和 topics，提出修改建議。
4. **社群貼文草稿**：每則用不同切角，不是同一段文字改寫。
   - 英文：
     - Reddit r/LocalLLaMA 長文：重方法和數據，切角可用「WSL2 silent VRAM spill」或「MTP draft vocab makes Chinese 2× slower」。
     - Hacker News「Show HN」標題和首段。
     - X 串文，5–7 則，可用 `outreach/clip-speed-6s.gif`。
   - 中文：Threads 或 Facebook 一則；PTT 或 Mobile01 風格一則（如果合適）。
5. **上游 issue 草稿**（feveromo/recipes-qwen3.8-27b-5070ti）
   - 回報 E25（adaptive draft length 讓 temperature 0 不可重現）和 E09（草稿詞表依英文排序，中文接受率低）。
   - 附數據連結和重現條件；語氣是感謝加回饋。
6. **發佈時程建議**：先後順序、時段、各平台之間的互相導流。

## 第 3 步：驗證（用另一個 agent 或 subagent 做，不能自己審自己）

- **事實核對表**：列出所有草稿裡的每個數字和每個比較性說法，對照 `EVIDENCE-INDEX.md` 的 ID、值和等級，不符就修。特別檢查有沒有不小心寫出「最好」「勝過」之類的字眼。
- **隱私掃描**：掃鐵則第 4 條的那些內容。
- **建置與預覽**：本機 build 部落格和網站，確認影片能播、圖片路徑對、手機版不破版；有 Playwright 就截圖給我看。
- **連結檢查**：所有對外連結都指向 `main`，不是 `outreach-kit`。

## 最後回報

- 產出清單：檔案路徑和狀態（草稿／已驗證）。
- 事實核對表、隱私掃描結果、預覽截圖。
- 需要我批准的對外動作，逐條列出動作與目標，並標出建議先批准哪一條、為什麼。
- 提醒我：全部發佈完成後刪除 `outreach-kit` 分支。
