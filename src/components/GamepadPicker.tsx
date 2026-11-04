import type { PadSnapshot } from '../input/GamepadController';
export const PAD_STATUS = {
  virtual: '鍵盤／虛擬搖桿操作',
  waiting: '請放開兩個實體搖桿，回中後啟用',
  ready: '實體手把已啟用 · 依目前飛行模式操控',
  paused: '輸入暫停 · Arm／返回後請先將搖桿回中',
  disconnected: '手把已斷線，已清除輸入並恢復虛擬搖桿',
  unavailable: '無法讀取手把，請使用 HTTPS 或 localhost，並確認瀏覽器允許 Gamepad API',
};
const COMPACT_STATUS:Record<PadSnapshot['status'],string>={virtual:'',waiting:'請回中',ready:'已啟用',paused:'待命／回中',disconnected:'已斷線',unavailable:'不可用'};
/** Mobile status belongs to the existing header button, never a floating scene panel. */
export function GamepadStatusBadge({status}:{status:PadSnapshot['status']}){
  return COMPACT_STATUS[status]?<small className="gamepad-status-badge" data-pad-state={status} role="status">{COMPACT_STATUS[status]}</small>:null;
}
interface Props { snapshot: PadSnapshot; onSelect: (index: number | null) => void; onClose: () => void }
export function GamepadPicker({ snapshot, onSelect, onClose }: Props) {
  return <section className="gamepad-picker" aria-label="控制裝置設定" id="gamepad-settings">
    <div className="picker-title"><h2>控制裝置</h2><button onClick={onClose} aria-label="關閉控制裝置設定">✕</button></div>
    <label htmlFor="controller-device">選擇操控來源</label>
    <select autoFocus id="controller-device" value={snapshot.selected ?? 'virtual'} onChange={event => onSelect(event.target.value === 'virtual' ? null : Number(event.target.value))}>
      <option value="virtual">鍵盤／虛擬搖桿</option>
      {snapshot.devices.map(device => <option key={`${device.index}:${device.id}`} value={device.index} disabled={!device.supported}>{device.name}{device.supported ? '' : '（非標準映射，暫不支援）'}</option>)}
    </select>
    <p className="device-status" role="status">{PAD_STATUS[snapshot.status]}</p>
    {!snapshot.devices.length && snapshot.status !== 'unavailable' && <p>尚未偵測到手把。請先以 USB 或藍牙連接 Xbox／PS5 DualSense，再按任一手把按鈕讓瀏覽器辨識。</p>}
    <p>左桿：升降／轉向；右桿：前後／平移。使用瀏覽器標準映射，含搖桿死區。選用實體手把後，虛擬搖桿會隱藏。</p>
    <p>關閉設定並按 Arm 後，先放開兩桿回中，再推左桿向上起飛。Arm／Disarm、降落、模式切換與重置使用畫面按鈕；R 可重置。姿態模式放桿後仍會漂移。</p>
    <button className="picker-done" onClick={onClose}>完成設定</button>
  </section>;
}
