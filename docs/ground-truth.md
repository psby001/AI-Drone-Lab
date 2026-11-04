# Ground Truth 與影像標註使用指南

[返回 README](../README.md)

## 在介面拍攝與匯出

1. 啟動平台，在網址加入 `?developer=1`，例如 `http://127.0.0.1:5173/?developer=1`。
2. 按頂部「開發者 GT」。在自由飛行模式按「載入 GT 測試場景（重置飛機）」；挑戰進行中不能切換測試場景。
3. 手動飛行與調整相機／雲台，或按「測試飛行：8m 斜拍」。
4. 按「拍照並計算 GT」。勾選顯示工具，可查看 3D Bounding Box、Frustum 與該張照片的 2D 標註。
5. 下載影像 PNG、標註 JSON、YOLO labels TXT 與 classes.json。一般相機拍照與任務 capture_photo 同樣走既有同步拍照流程，可從照片清單選取後「查詢同張照片標註」。

3D 框反映即時場景；2D 疊圖反映選定照片，不會隨後續移動改變。除錯框不燒錄至原始 PNG。照片與標註有容量限制，舊照片被淘汰後可能無法查詢，請及時匯出。

## 標註內容與座標

CameraSnapshot 包含 photo_id、frame_id、timestamp、simulation_time、影像尺寸、Blob 影像、相機世界／投影矩陣、內參、無人機／雲台姿態、scene_id 與 object_annotations。記憶體使用 Blob，不逐影格強制轉 Base64；`snapshotJson` 供匯出序列化資料。

每個物件包含 object_id、class_id、class_name、世界位置／旋轉、3D 邊界、2D 框、投影中心、面積及可見性。相同類別可有多個 object_id。世界資料使用 ENU 公尺制；2D 像素座標以影像左上為原點，x 向右、y 向下。normalized_box／normalized_center 使用 0–1 座標。

| 指標 | 語意 |
| --- | --- |
| visibility_ratio | 影像內打中目標的取樣射線中，未被其他場景物件擋住的比例 |
| in_frame_ratio | 目標 3D 包圍盒投影輪廓落在畫面內的比例估計 |
| visible_area_ratio | 估計目標實際可見部分占整張影像的比例 |
| is_valid_annotation | 底層標註有效性，不等於通過任何關卡的有效照片要求 |

三種比例不能互相替代。攝影尋寶另有可配置的門檻與構圖計分；目前預設可見率與入框率各 ≥20%，可見面積 ≥3%。

## 內部模組與擴充

| 模組 | 用途 |
| --- | --- |
| TargetRegistry | 類別、唯一物件 ID、即時世界 Transform 與 scope 清理 |
| projection.ts | 使用實際渲染相機矩陣，處理 near/far 與影像邊界裁切 |
| visibility.ts | 分層畫面射線取樣，判斷目標自身命中與最近遮擋物 |
| GroundTruthService | 場景啟用、拍攝狀態凍結、Blob 提交、快照查詢與匯出 |
| DroneScene | 將真值服務與既有相機、場景生命週期整合 |

註冊目標的實際介面範例：

```ts
import { TargetRegistry } from '../src/groundTruth/TargetRegistry';

const registry = new TargetRegistry();
registry.registerClass({class_id: 0, class_name: 'car'});
// carMesh 是已加入場景的 Three.js Object3D。
const unregister = registry.registerTarget({
  object_id: 'car-01', class_id: 0, display_name: '紅色汽車',
  mesh_reference: carMesh, visibility_enabled: true, annotation_enabled: true
}, 'my-scene');
// registry.getTargets() 會讀取最新的物件與父子 Transform。
// 卸載時 unregister()，或 registry.clearScope('my-scene')。
```

這是介面示意；整合既有場景時應使用 DroneScene 的既有 registry／scope 流程，不為關卡另建 Registry。可參考 `src/groundTruth/testScene.ts`、`src/challenges/photoHunt/scene.ts`。

拍照整合使用 `DroneScene.captureAnnotatedPhoto()`，查詢使用 `scene.internalGroundTruth.getPhotoSnapshot(photo_id)`。相機 observer 在拍攝時先以 `preparePhoto` 凍結幾何與姿態，像素非同步編碼後以 `commitPhoto` 提交 Blob，不能使用新位置重算舊照片。關卡訂閱沿用 `subscribeAnnotatedPhotos` 與回合 token；評分只讀該張快照。

## YOLO 標註與未來推論

`exportYolo(snapshot)` 輸出有效標註，每列 `class_id center_x center_y width height`，中心與尺寸均正規化。PNG／JSON／TXT 應以同一 photo_id 命名，類別以同次匯出的 classes.json 為準。這是包圍盒資料，不是像素級分割。

未來辨識模組可從既有 CameraFrameProvider 取得影像；模型結果應建立獨立 ObjectPrediction（含 model_id、photo_id、confidence 與 bbox），不可覆寫 Ground Truth。`comparison.ts` 可做同照片同類別的 IoU 比對，目前不等於完整 mAP 評估。

## 限制與隔離

可見性按拍照需求計算，不在每個渲染影格大量投射射線。3D 邊界會處理旋轉、縮放與父子矩陣的八角點；投影會裁切 near plane，完全在後方的目標不產生有效框。

射線取樣是面積估計：小目標、細枝、透明／特殊材質、極近距離可能誤差較大，沒有命中的小目標可能標示 unsampled。不要將 bbox 在畫面內當成可見證據，也不要將輸出當作完美分割。

Ground Truth 僅供內部評分、測試與資料集匯出，預設不向玩家顯示，也不傳送隱藏世界座標給 AI 規劃器。整個模擬器在瀏覽器執行，此隔離防止一般 UI/API 誤用，不能視為防作弊安全邊界。
