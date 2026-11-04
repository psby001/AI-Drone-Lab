# JSON 任務系統

[返回 README](../README.md)

## 載入與執行

開啟「任務」，選擇預設任務、貼入 JSON 或匯入檔案，按「載入並驗證」。確認步驟與路徑預覽後按「開始」。執行中可暫停、繼續或停止；停止後需落地或重置才可重新開始。暫停不計有效執行時間。

## 格式與座標

根物件包含 `commands`（必填陣列）、`version`（建議 `"1.2"`）、`name`（選填，最多 80 字）與 `home`（GPS 任務需要）。未知欄位或動作會被拒絕，不接受註解或尾端逗號。

- 世界座標 ENU：x 東、y 北、z 上；單位公尺。Three.js 場景座標為 `(E,U,-N)`。
- `goto_local` 的 x/y 相對本次起飛點；所有 altitude/z 相對起飛地面，不是目前高度或海拔。
- 航向北 0°、東 90°、南 180°、西 270°；順時針為正。
- 前後左右依規劃機頭方向平移，不會自動轉向；`goto_local` 也不會自動面向目的地。
- `speed` 依動作分別使用水平 m/s、升降 m/s 或轉向 °/s；距離為 m、角度為 °、時間為 s。

```json
{
  "version": "1.2",
  "name": "轉向與前進",
  "commands": [
    {"action": "takeoff", "altitude": 5},
    {"action": "move_forward", "distance": 10},
    {"action": "turn_right", "angle": 90},
    {"action": "move_forward", "distance": 5},
    {"action": "land"}
  ]
}
```

## 支援動作

括號內為參數；「選填」以外均為必要參數。

| action | 參數與作用 |
| --- | --- |
| `takeoff` | `altitude`；選填 `speed`，自動解鎖並起飛 |
| `land` | 無參數，降落並停止馬達 |
| `move_forward` / `move_backward` | `distance`；選填 `speed`，向前／後平移 |
| `move_left` / `move_right` | `distance`；選填 `speed`，向左／右平移 |
| `turn_left` / `turn_right` | `angle`；選填 `speed`，相對轉向 |
| `ascend` / `descend` | `distance`；選填 `speed`，相對升降 |
| `change_altitude` | `altitude`；選填 `speed`，飛至指定高度 |
| `set_heading` | `heading`；選填 `direction: shortest/left/right`、`speed` |
| `hover` | `duration`，保持位置 |
| `set_speed` | `speed`；選填 `vertical_speed`，影響後續水平／升降速度 |
| `goto_local` | `x,y,z`；選填 `speed`，直線導航至本地座標 |
| `goto_gps` | `latitude,longitude,altitude`；選填 `speed` |
| `follow_waypoints` | `frame: local/gps`、`waypoints`；選填 `speed`。各點使用對應 goto 的座標欄位 |
| `return_to_launch` | 選填 `altitude,speed`；安全高度、返回、恢復航向、進場、懸停、降落 |
| `repeat` | 整數 `count` 與子陣列 `commands` |
| `parallel` | 子陣列 `commands`；選填 `reference_frame: body/start` |
| `set_camera_view` | `view: fpv/nadir/oblique/custom`；選填 `mode: body/stabilized` |
| `set_gimbal_pitch` | `angle`：−90～30°，負值向下 |
| `set_gimbal_yaw` | `angle`：−180～180°，相對機頭，正值向右 |
| `reset_gimbal` | 無參數，重置雲台 |
| `capture_photo` | 無參數，拍照 |
| `start_recording` / `stop_recording` | 無參數，開始／停止錄影，須成對使用 |

單步 `speed` 只覆寫該步；預設水平 2.5 m/s、升降 1.2 m/s、轉向 60°/s。GPS 使用 WGS84 十進位度，須在根物件提供 `home: {latitude,longitude}`；本地投影不代表可飛出活動範圍。

## 集中限制

設定來源為 `src/config/limits.ts`、`src/camera/types.ts`，驗證實作為 `src/missions/validate.ts` 與 `schema.ts`。

| 項目 | 限制 |
| --- | --- |
| 高度 | 0.5–20m；接地須用 land，不能以 z=0 替代 |
| 活動範圍 | 起飛點半徑 50m；另檢查世界原點半徑 50m，兩者都須符合 |
| 速度 | 水平 ≤5m/s、升降 ≤2m/s、轉向 ≤90°/s；皆須大於 0 |
| 相對移動／轉向 | 單次水平 distance ≤100m、升降 distance ≤20m、angle ≤360°；仍檢查累積路徑 |
| 指令數 | 展開後最多 15 條，包含相機與 set_speed |
| 航點／返航計數 | 每組 1–10 航點，每點算一條；返航算六條 |
| repeat | 1–4 次，最多巢狀兩層；展開後仍受 15 條限制 |
| 時間 | 估計與實際有效執行 ≤180s，單步 ≤60s，hover ≤30s |
| 錄影 | 單段 ≤120s；瀏覽器不支援時會失敗 |
| JSON | 輸入字串最多 20,000 bytes，深度 ≤12、節點 ≤500 |

只能起降一次，必須從地面開始。第一個飛行動作須 takeoff（之前可 set_speed），最後須 land 或 return_to_launch；相機動作可在起飛前或落地後。自動任務要求定位模式，執行中鎖定手動輸入。觸及邊界或逾時會失敗並定位保持。關卡另有自身邊界、碰撞及時間規則。

## 同時飛行與轉向範例

```json
{
  "version": "1.2",
  "commands": [
    {"action": "takeoff", "altitude": 5},
    {"action": "parallel", "reference_frame": "body", "commands": [
      {"action": "move_forward", "distance": 12.5663706144},
      {"action": "turn_right", "angle": 360}
    ]},
    {"action": "land"}
  ]
}
```

此例從目前位置開始順時針飛半徑約 2m 的圓，起點不是圓心。`body` 讓移動方向隨機頭轉動，distance 為路程；`start` 固定群組開始時方向。各軸使用同一平滑進度同步完成，速度參數為上限。

parallel 每組 2–4 個動作，前後、左右、升降、航向各最多一個，禁止同軸衝突。只能使用相對平移、升降／change_altitude、轉向／set_heading；不接受起降、goto、相機、repeat 或巢狀 parallel。子動作各算一條，群組本身不額外計數；驗證包含弧線中途邊界。

更多可載入範例見 [public/missions](../public/missions)。格式通過不代表自動避障，請在模擬器確認實際路徑。
