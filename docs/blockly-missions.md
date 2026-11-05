# Blockly 積木任務

[返回 README](../README.md)

## 使用方式

開啟「任務」，選擇預設或從工具箱拖入積木，將動作依序接入唯一的「任務」起點。修改數字或下拉選項後按「執行積木」。不合法、未連接或超出限制的任務會顯示錯誤，不會飛行。

工具箱包含飛行動作、組合動作、航點、相機與雲台。選填參數以「設定」勾選是否採用；不勾選時保留原任務的預設語意。GPS 任務需在任務起點勾選起飛參考並填寫緯經度。任務起點的版本保留舊預設相容性，使用新動作時選擇 1.2。

執行時積木鎖定，可暫停、繼續或停止；停止後仍需落地或重置飛機才能重跑。「清空積木」只清除編輯工作區。AI 產生的合法任務自動載入工作區，須由學生確認後執行。

「儲存積木／載入積木」在此瀏覽器保存一份工作區；跨裝置可下載與開啟 `.droneblocks`。檔案內容是 Blockly serialization 狀態，不是可匯入的 Mission JSON，不可用舊任務 JSON 檔代替。工作區上限由目前任務預算推導；檔案最多 200,000 字元，過大、未知積木或不合法參數會拒絕載入。

航點預覽依目前合法積木即時更新，包含 ENU 俯視路線、平行飛行曲線、步驟、預計時間與執行進度。未接好或不合法的積木不會保留舊路徑；不顯示 Mission JSON。

## 資料流與模組

`Blockly Workspace → workspaceToMission → validateMission → 原 MissionRunner`

- `src/blockly/missionBlocks.ts`：積木註冊、Schema 對應、工具箱、雙向轉換與工作區檔案檢查。
- `BlocklyMissionEditor.tsx`：Blockly 注入、SVG 尺寸更新、工作區儲存與卸載清理。
- `MissionPanel.tsx`：執行／停止／暫停、預設、錯誤及 Python 展示。
- `AiMissionComposer.tsx`：自然語言解析後交回工作區，不自動起飛。

積木參數由既有 Schema 派生：每個 action 對應積木；local／GPS 航點分成不同類型。`repeat` 與 `parallel` 保留內嵌子積木，航點使用專用航點積木串列。只支援既有有界 repeat，不新增其他迴圈、變數、條件或程式碼執行功能。

Mission → Blockly 會先通過原 Validator，再建立 workspace state，保留 version、name、home、選填欄位及動作順序。Blockly → Mission 檢查唯一根積木、所有連接及未支援積木，完整遍歷後再驗證。沒有使用 JavaScript generator、eval 或 AI 任意程式碼。

Python 生成功能讀取目前已通過驗證的積木任務；任務不合法時不顯示舊任務程式碼。相機任務仍受原 Python 匯出限制。

## 擴充與安全限制

新增 Mission action 時，先更新既有 Schema／型別及既有系統支援，再於 missionBlocks 的名稱／分類對應加入繁體中文說明。數字與 enum 純量參數會依 Schema 自動註冊；特殊結構可使用 `registerMissionBlock(MissionBlockSpec)` 與對應轉換規則。不得新增 Schema 不支援的積木功能，也不需要修改編輯器 UI 核心。

任務時間、半徑、高度、repeat、parallel 衝突等規則仍由原驗證器處理。現行 `MISSION_LIMITS.maxCommands` 為 100；場景較小時，執行器開始前仍檢查場景邊界。以 `src/config/limits.ts` 為實際設定來源。

使用 Blockly 13.4.0，媒體資產置於 `public/blockly-media/`，保留其 Apache-2.0 LICENSE；未透過 CDN 載入。升級套件時需同步更新本地媒體資產並重跑測試。

## 測試與已知限制

`tests/blockly-missions.test.ts` 驗證全部預設的往返、參數與結構保留、存取拒絕、原物理飛行與 Python 匯出；既有 AI／任務 UI 測試已改為積木流程。瀏覽器另檢查實際數字編輯、工作區儲存與任務啟動。

工作區可保存未完成草稿，但執行前必須接好所有積木並通過驗證。複雜任務需平移或縮放工作區；手機可用工具箱操作，但小螢幕拖曳精準度仍不及電腦。Blockly 使前端下載體積增加，初次載入依網路與裝置而異。

API 參考：[Blockly 工作區 serialization](https://docs.blockly.com/guides/configure/serialization/)。
