# 自由飛行場景開發

## 架構

`src/scenes/FreeFlightScenes.ts` 定義 FreeSceneDefinition、FreeSceneRegistry 與 FreeSceneManager。
場景工廠沿用 `src/challenges/scene.ts` 的 SceneFactory／ThreeChallengeSceneProvider，沒有另一套 Renderer 或飛行模型。
`src/scenes/catalog.ts` 是靜態註冊入口，SceneSelector 讀取 registry，不依場景 ID 建立選單。

每個 FreeSceneDefinition 必須提供：

| 欄位 | 用途 |
| --- | --- |
| id、title、description、category、thumbnail | 場景識別與選單資料 |
| spawn_position、spawn_heading | ENU 公尺、北 0° 順時針；出生高度目前須為地面 0 |
| initial_camera_pose | 第三人稱相機初始位置，也是固定觀察點 |
| flight_bounds.radius、max_altitude | 以世界原點為中心的圓柱範圍；場景物理容量上限為半徑 60m／高度 50m（SCENE_LIMITS） |
| environment_settings | preset（calm/breeze/strong，以 environment.ts 為準）與 direction |
| scene | 共用 SceneFactory 的 type、params、seed、objects 與 environment |

Manager 提供 loadScene、switchScene、unloadScene、getActiveScene、listScenes、pause、resume、dispose；registry 提供 registerScene、unregisterScene、get、listScenes 與 factories。
應在啟動前註冊插件；不要在使用中的場景直接移除定義，先切換至其他場景。

## 新增海岸範例

新增 `src/scenes/coastal.ts`，內容如下（這只是開發範本，不會預設載入第五張地圖）：

```ts
import * as THREE from 'three';
import type { FreeSceneRegistry } from './FreeFlightScenes';

export function registerCoastal(c: FreeSceneRegistry) {
  c.factories.register('coastal-field', {
    schema: {type: 'object', additionalProperties: false},
    create(definition) {
      const root = new THREE.Group();
      // Scene-local resources: the provider disposes these on unload.
      const sand = new THREE.Mesh(
        new THREE.BoxGeometry(120, .1, 120),
        new THREE.MeshStandardMaterial({color: '#d8c89d'})
      );
      sand.position.y = -.06;
      root.add(sand);
      const sea = new THREE.Mesh(
        new THREE.BoxGeometry(40, .02, 100),
        new THREE.MeshStandardMaterial({color: '#5ba6b5'})
      );
      sea.position.set(-35, .01, 0);
      root.add(sea);
      const target = new THREE.Mesh(
        new THREE.BoxGeometry(2, 2, 2),
        new THREE.MeshStandardMaterial({color: '#eccf60'})
      );
      target.position.set(10, 1, -10); // Three.js (E,U,-N).
      target.userData.annotationTarget = {
        object_id: `${definition.id}:container:1`, class_id: 3,
        display_name: '海岸貨櫃'
      };
      root.add(target);
      return root;
    }
  });
  c.registerScene({
    id: 'coastal', title: '海岸場景', category: '自然地景',
    description: '沙灘與海面空拍練習。', thumbnail: '/scenes/coastal.svg',
    spawn_position: {east: 0, north: 0, up: 0}, spawn_heading: 0,
    initial_camera_pose: {east: 8, north: -12, up: 7},
    flight_bounds: {radius: 35}, max_altitude: 15,
    environment_settings: {preset: 'calm', direction: 90},
    scene: {type: 'coastal-field', params: {}, seed: 42, objects: [],
      environment: {wind: 'calm', direction: 90}}
  });
}
```

在 `catalog.ts` 匯入並於 return 前呼叫 `registerCoastal(c)`，再提供 `/public/scenes/coastal.svg`。
無須修改 FlightModel、Manager、Selector 或其他場景。若要碰撞，提供 SceneFactory.colliders(definition) 回傳 SceneObject；上述範本的貨櫃未設定碰撞，需自行補入。

既有類別 car=0、person=1、building=2、container=3、tent=4、tree=5。
新增類別時應在共用 TargetRegistry 初始化註冊，不把類別判斷寫進 GroundTruthService。
同一類別可有不同 object_id，建議使用場景 ID 前綴。

## 生命週期與非同步載入

切換流程：UNLOADING → LOADING → READY → ACTIVE；尚未載入為 UNLOADED，無法復原時為 ERROR。
切換前清除輸入、中止任務／相機指令、停止錄影並暫停模擬；完成後更新出生點、飛行邊界、風、觀察相機與雲台。
每次切換有獨立 AbortSignal／generation；晚回來的場景會被釋放，不得覆蓋最新選擇。
失敗時會重新載入上一個可用場景並重設飛機，保留錯誤提示；首次載入失敗可重新選擇場景。

同步場景實作 create；需要非同步資產時可另外提供 `load(definition,signal): Promise<THREE.Group>`。
工廠應檢查 signal、清理自身載入失敗前取得的資源，並讓出主執行緒。
Provider 會清理已成功回傳但過期的 Group。請勿在工廠建立永久 setInterval、動畫迴圈或全域監聽器。
需要特殊外部資源時，擴充共用 Provider 的生命週期，不在 UI 偷掛獨立管理器。

## 資源與 Ground Truth

回傳 Group 必須只擁有本場景專用物件。Provider 透過 disposeSceneGroup 釋放 Geometry、Material、Texture、InstancedMesh，並移除 Group。
目前內建場景每次建立自己的資源，無跨場景 GPU 資產快取；若未來引入共用快取，應採參照計數或明確所有權，勿把仍被其他場景使用的材質放入自動釋放的專用 Group。

在根物件標記 `userData.annotationTarget` 即可交給既有 registerTree／scope 流程。啟用時清除前場景註冊，卸載時解除；不需再建立 Registry。
照片在快門時凍結 scene_id、矩陣與標註，切換後仍保留舊照片自身的拍攝資料，不會以新場景重算。

挑戰場景啟用時隱藏整個自由飛行環境容器，沿用同一相機與飛行核心；返回後恢復原自由場景與 GT，重設該場景出生點／邊界。
自由場景選單在挑戰期間停用；自由飛行不啟動挑戰計分。保留一份自由場景於記憶體供返回，不會每次挑戰再複製。

## 測試與限制

新增測試參考 `tests/free-scenes.test.ts`，驗證註冊、載入、取消競態、錯誤復原、GT scope、出生點／邊界、任務與清理。執行 `pnpm test` 與 `pnpm build`。

- 山丘是視覺地形加保守 AABB 碰撞範圍，地面物理仍為 z=0；不支援山坡／屋頂起降或地形追隨。
- 自由飛行撞到已設定實體物件會暫停，需重置或換場；沒有彈跳、破壞或精確網格接觸物理。
- 考試場景為半徑 60m、限高 50m；JSON／AI 任務仍受原本半徑 50m、限高 20m 的驗證限制，其他場景維持各自設定；任務開始時會依實際起點重編譯並檢查場景範圍。
- 本階段不含 YOLO、遠端插件與地圖下載。第三方模組須在建置時靜態註冊。
- 考試練習場依本機參考專案重建：80×20m 標示區、26×14m 中央區、中心相隔12m的雙圓，半徑4／6／8m、P1–P7 與 H 點。圓柱安全邊界與標示區分別呈現；不宣稱取得考場認證，也未實作官方完整測驗流程。
- 實際考試分類與要求請核對 [民航局 AC 107-005D 規範](https://www.caa.gov.tw/Article.aspx?a=4308&lang=1)，不要以此練習場取代官方文件。
