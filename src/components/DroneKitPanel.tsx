import { useEffect,useState } from 'react';
import { generatePython,TEMPLATE_SYNTAX,TEMPLATE_API,type PythonArtifact } from '../dronekit/generate';
/** Lexical highlighting; React escapes tokens. Never render code as HTML. */
function highlight(line:string){
  return line.split(/(#.*$|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\b(?:def|class|import|from|if|else|elif|for|while|return|raise|try|except|finally|with|as|and|or|not|in|is|None|True|False)\b|\b\d+(?:\.\d+)?\b)/g).map((part,i)=><span key={i} className={part.startsWith('#')?'py-comment':/^['"]/.test(part)?'py-string':/^\d/.test(part)?'py-number':/^(def|class|import|from|if|else|elif|for|while|return|raise|try|except|finally|with|as|and|or|not|in|is|None|True|False)$/.test(part)?'py-keyword':undefined}>{part}</span>);
}
export function DroneKitPanel({source,dirty=false}:{source:unknown;dirty?:boolean}){
  const [artifact,setArtifact]=useState<PythonArtifact>();
  const [error,setError]=useState(''),[notice,setNotice]=useState('');
  const [selected,setSelected]=useState<number>();
  const [showRuntime,setShowRuntime]=useState(false);
  const current=artifact?.steps.find(step=>step.line===selected)??artifact?.steps[0];
  useEffect(()=>{let active=true;setArtifact(undefined);setError('');setNotice('');setSelected(undefined);if(!dirty)void generatePython(source).then(value=>{if(active)setArtifact(value);}).catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'程式碼產生失敗');});return()=>{active=false;};},[source,dirty]);
  const download=()=>{if(!artifact)return;const url=URL.createObjectURL(new Blob([artifact.code],{type:'text/x-python;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='ai-drone-mission.py';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setNotice('已下載完整 Python 腳本');};
  return <details className="dronekit-panel"><summary>DroneKit-Python 程式碼</summary>
    <section className="python-run-guide" aria-label="Python 執行方式">
      <h3>如何執行</h3>
      <ol>
        <li>準備 Python 3.9 環境，安裝所需套件：<pre><code>python -m pip install dronekit==2.9.2 pymavlink==2.4.49 future==1.0.0 dronekit-sitl</code></pre></li>
        <li>下載下方的 <code>ai-drone-mission.py</code>，在終端機切換至檔案所在資料夾。</li>
        <li>開啟另一個終端機，在相同 Python 環境啟動模擬飛控：<pre><code>dronekit-sitl copter</code></pre>保持此視窗開啟，等待飛控初始化。</li>
        <li>先檢查腳本，再執行模擬飛行：<pre><code>{'python ai-drone-mission.py --check\npython ai-drone-mission.py --execute-sitl --connect tcp:127.0.0.1:5760'}</code></pre></li>
      </ol>
      <p className="mission-hint">兩個終端機需使用相同 Python 環境。若 SITL 使用其他 TCP 埠，請調整 --connect；GPS 任務的 home 須與 SITL 起點一致。舊版 SITL 韌體可能不支援部分指令。</p>
      <p className="mission-hint">網頁僅產生程式碼，不會連線飛控。執行前請確認端點為本機 SITL；模擬測試不代表可安全實飛。</p>
    </section>
    {dirty?<p role="status">積木已修改，請先完成任務驗證。</p>:error?<p role="alert">{error}</p>:!artifact?<p role="status">正在驗證任務並產生程式碼…</p>:<>
      <details><summary>程式碼驗證資訊</summary><ul className="code-validation"><li>任務參數與安全限制：通過</li><li>Python 模板語法：{TEMPLATE_SYNTAX.passed?`Python ${TEMPLATE_SYNTAX.python} AST 通過`:'未檢查'}</li><li>模板 API：{TEMPLATE_API.passed&&TEMPLATE_API.versions?`DroneKit ${TEMPLATE_API.versions.dronekit}／pymavlink ${TEMPLATE_API.versions.pymavlink} 套件與編碼測試通過（非 SITL）`:'未取得符合本模板的套件測試記錄'}</li><li>下載腳本：請執行 --check 檢查</li><li>SITL：尚未驗證；不可視為可安全實飛</li></ul></details>
      <div className="mission-files"><button onClick={()=>{if(!navigator.clipboard){setNotice('無法使用剪貼簿，請下載 .py');return;}void navigator.clipboard.writeText(artifact.code).then(()=>setNotice('已複製程式碼')).catch(()=>setNotice('無法使用剪貼簿，請下載 .py'));}}>複製 Python</button><button onClick={download}>下載 .py</button></div>
      <p role="status">{notice}</p>
      <label className="mission-label">任務步驟與程式碼對照<select value={selected??''} onChange={e=>{const line=Number(e.target.value);setSelected(line);const target=document.getElementById(`python-line-${line}`);const pre=target?.closest('pre');if(target&&pre){pre.scrollTop=target.offsetTop-pre.clientHeight/2;pre.scrollLeft=0;pre.scrollIntoView({block:'center'});}}}><option value="" disabled>選擇步驟以定位呼叫行</option>{artifact.steps.map(s=><option key={s.index} value={s.line}>{s.index+1}. {s.label} · L{s.line} · {s.sourcePath}</option>)}</select></label>
      <p className="mission-hint">下方顯示任務指令；drone.parallel() 內的動作同時執行。複製與下載會包含完整腳本。</p>
      <label className="mission-label"><input type="checkbox" checked={showRuntime} onChange={e=>setShowRuntime(e.target.checked)}/> 顯示完整腳本與底層控制函式庫</label>
      <pre className="python-code" aria-label="DroneKit Python 程式碼" tabIndex={0}><code>{(showRuntime?artifact.code:artifact.missionCode).split('\n').map((line,i)=><span id={`python-line-${i+1}`} key={i} className={'python-line '+(selected===i+1?'selected':'')}><span className="line-number" aria-hidden="true">{i+1}</span>{highlight(line)}{'\n'}</span>)}</code></pre>
      {current?.implementation&&<section className="implementation-trace" aria-label="所選步驟的 DroneKit 實作"><h3>{current.index+1}. {current.label}：底層如何執行？</h3><p className="mission-hint">{current.implementation.explanation}</p>{current.target&&<p className="mission-hint">本步編譯目標：東 {current.target.east.toFixed(2)}m、北 {current.target.north.toFixed(2)}m、高 {current.target.up.toFixed(2)}m、航向 {current.target.heading.toFixed(2)}°。</p>}<p className="mission-hint">以下為完整腳本中的 DroneKit／MAVLink 呼叫；L 為行號，self.v 為飛控連線物件。</p>{current.implementation.snippets.map(snippet=><details key={`${current.index}-${snippet.name}`} open={['DroneController.send_target','DroneController.takeoff','DroneController.land'].includes(snippet.name)}><summary>{snippet.title} · L{snippet.line}</summary><pre className="python-code" aria-label={snippet.name}><code>{snippet.code.split('\n').map((line,i)=><span className="python-line" key={i}><span className="line-number" aria-hidden="true">{snippet.line+i}</span>{highlight(line)}{'\n'}</span>)}</code></pre></details>)}</section>}

    </>}
  </details>;
}
