# 關卡開發指南

[返回 README](../README.md)

## 架構與現有範例

`ChallengeManager` 管理載入、倒數、暫停、結算及重試；`PluginRegistry` 註冊場景、規則與計分策略；`ResultRepository` 負責儲存。新增關卡通常只需新增定義與插件並在 catalog 組裝，不需修改 Manager 核心。

建議參考精簡的 `src/challenges/precisionLanding.ts`，進階競速見 `racing.ts`／`racingScene.ts`，相機整合見 `photoHunt/`。實際型別集中於 `src/challenges/types.ts`，以程式介面為準。

## 開發流程

1. **定義玩法與資料**：建立唯一 `id`、`version`、標題、介紹、難度、縮圖、spawn、time_limit、allowed_control_modes、metadata。控制來源可選 MANUAL、AI_MISSION、MIXED。規則／場景／計分使用 `{type,params}` 指向插件，不新增巨大的通用設定物件。
2. **設定獨立場景**：`scene` 包含 type、params、seed、objects、environment。沿用已註冊場景，或實作 `SceneFactory` 的 schema 與 `create(definition): THREE.Group`，再視需要提供 `colliders`、`update`、`validateDefinition`。每次用同一 seed 應產生相同配置；可用 `scene.ts` 的 `seededRandom`。
3. **實作目標與規則**：`RulePlugin` 提供 schema、選用 validate，以及 `create(params)`。回傳的 `RuleInstance.evaluate(input)` 讀取實際 drone、previous、dt、simulation_time 與 events，輸出 progress、complete、failed、violations、metrics 等。目標放在 `objectives`，失敗與限制放在 `rules`，每項都有唯一 id。
4. **實作計分**：`ScoringStrategy.score(context,params)` 回傳 final_score、score_unit、score_direction、penalties、bonuses、lines。時間越低越好用 `lower`，分數越高越好用 `higher`。將規則產生的 metrics 交給計分策略，不依玩家按過哪個指令推算完成。
5. **註冊插件與定義**：在 `src/challenges/catalog.ts` 的 `createChallengeCatalog()` 註冊規則、場景、計分插件，再 `c.registry.register(definition)`。同步加入同檔 `CHALLENGE_DEFINITIONS`，讓匯出工具包含新關卡。重複 id、未註冊 type 或不符 schema 都會被拒絕。
6. **加入介面與測試**：一般開始、暫停、重試、離開與結算沿用 ChallengePanel／HUD。只有新增特殊資訊時才增加關卡 readout。執行測試與 build，確認 `public/challenges/` 匯出結果。

註冊結構示意（變數代表自行實作的插件與定義）：

```ts
c.rules.register('my-objective', myRulePlugin);
c.scenes.register('my-scene', mySceneFactory);
c.scoring.register('my-score', myScoringStrategy);
c.registry.register(myDefinition);
```

## 關卡資料約定

| 欄位 | 用途 |
| --- | --- |
| id / version | 穩定識別關卡與規則版本；影響成績分類 |
| scene | 插件 type、params、seed、物件、風場 |
| spawn | ENU position 與 heading，公尺／度 |
| objectives | id、title、order、type、params |
| rules | id、type、params；邊界、碰撞或其他限制 |
| scoring | 計分插件 type 與 params |
| allowed_control_modes | 可參與的控制來源 |
| time_limit | 關卡有效執行秒數，與 JSON 任務時限獨立 |
| metadata | 關卡專用資料 |

完整可載入資料可參考 [精準降落定義](../public/challenges/precision-landing.json)；通用 schema 見 [challenge.schema.json](../public/challenges/challenge.schema.json)。更改插件 schema 後需執行 build 更新匯出。

## 狀態、時間與清理

狀態包含 IDLE、LOADING、READY、COUNTDOWN、RUNNING、PAUSED、COMPLETED、FAILED、ABORTED。倒數完成才計時，暫停不增加有效時間。使用 input.dt 累積狀態，不按渲染影格數計分；高速穿越航點應採 previous→current 連續線段判定。

場景應回傳獨立 Group，交給 Scene Provider 卸載；規則持有監聽器等資源時提供 dispose。不得釋放共用無人機、相機或飛行核心。目標註冊與拍照事件沿用 Ground Truth 生命週期，異步事件應綁定 attempt token，避免舊照片進入新回合。

成績沿用 Repository 與設定／版本／seed／控制來源分類。修改規則或計分請更新版本，不混用不相容紀錄。

## 驗證清單

- 定義與各插件 params 通過 schema；相同 seed 場景可重現。
- 手動、JSON／AI 任務及混合控制使用相同狀態判定；未呼叫特定指令也能按實際狀態完成。
- 成功、碰撞、超界、逾時、中止、暫停、重試與離開均正常。
- 低／高更新頻率下計時與分數一致；高速不漏掉航點。
- 成績方向、保存及不同關卡資料隔離正確。
- 切換場景後無殘留目標、物件、事件或計時；原有相機與關卡仍正常。

測試框架沿用 `tests/precision-landing.test.ts`、`tests/racing.test.ts`、`tests/photo-hunt.test.ts` 及對應 UI 測試。執行 `pnpm test` 與 `pnpm build`，不需新增大型框架。
