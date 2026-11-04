import { useEffect,useState } from 'react';

/** Request the document root so fixed panels and both camera/flight views stay together. */
export function PageFullscreenButton(){
  const [active,setActive]=useState(false),[pending,setPending]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{const sync=()=>setActive(document.fullscreenElement===document.documentElement);sync();document.addEventListener('fullscreenchange',sync);return()=>document.removeEventListener('fullscreenchange',sync);},[]);
  const toggle=async()=>{
    if(pending)return;setMessage('');
    const root=document.documentElement;
    if(typeof root.requestFullscreen!=='function'||typeof document.exitFullscreen!=='function'){setMessage('此瀏覽器不支援頁面全螢幕，可改用加入主畫面的 Web App 模式。');return;}
    setPending(true);
    try{if(document.fullscreenElement===root)await document.exitFullscreen();else await root.requestFullscreen();}
    catch{setMessage('瀏覽器未允許頁面全螢幕，請直接點按按鈕重試，或使用加入主畫面的 Web App 模式。');}
    finally{setPending(false);setActive(document.fullscreenElement===root);}
  };
  return <div className="page-fullscreen-control">
    <button className="help-button page-fullscreen-button" aria-label={active?'退出頁面全螢幕':'頁面全螢幕'} aria-pressed={active} disabled={pending} title={active?'退出整個頁面的全螢幕，也可按 Esc':'讓場景、相機、儀表與控制介面一起全螢幕顯示'} onClick={()=>void toggle()}><span aria-hidden="true">⛶</span><span className="page-fullscreen-label">{active?'退出全螢幕':'全螢幕'}</span></button>
    {message&&<div className="fullscreen-feedback"><span role="status">{message}</span><button aria-label="關閉全螢幕提示" onClick={()=>setMessage('')}>×</button></div>}
  </div>;
}
