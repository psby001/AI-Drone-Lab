import {it} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {act,createElement} from 'react';
import {layoutMedia,setInterfaceLayout,useInterfaceLayoutStyles,InterfaceLayoutButton} from '../src/interfaceLayout';
it('manual layouts override tablet dimension breakpoints while retaining orientation queries',()=>{
  assert.equal(layoutMedia('(max-width:700px)','mobile',1024,1366),'(min-width: 0px)');
  assert.equal(layoutMedia('(max-width:700px)','desktop',390,844),'(max-width: 0px)');
  assert.equal(layoutMedia('(orientation:landscape) and (max-height:600px)','mobile',1366,1024),'(orientation:landscape) and (min-width: 0px)');
  assert.equal(layoutMedia('(prefers-reduced-motion:reduce)','mobile',1024,1366),'(prefers-reduced-motion:reduce)');
});
it('button changes stylesheet layout, persists choice, and restores native rules on unmount',async()=>{
  const dom=new JSDOM('<head><style>@media(max-width:700px){.sample{display:none}}</style></head><body><div id="root"></div></body>',{url:'http://localhost'});
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,MutationObserver:dom.window.MutationObserver,IS_REACT_ACT_ENVIRONMENT:true,requestAnimationFrame:(fn:()=>void)=>setTimeout(fn,0),cancelAnimationFrame:clearTimeout});
  Object.defineProperty(dom.window,'innerHeight',{value:1366,configurable:true});
  dom.window.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}}) as unknown as MediaQueryList;
  const {createRoot}=await import('react-dom/client');const root=createRoot(document.getElementById('root')!);
  function Harness(){useInterfaceLayoutStyles();return createElement(InterfaceLayoutButton);}
  const rule=document.styleSheets[0].cssRules[0] as CSSMediaRule;
  try{await act(()=>root.render(createElement(Harness)));assert.equal(document.querySelector('button')!.textContent,'手機版');
    await act(()=>document.querySelector('button')!.click());assert.equal(window.localStorage.getItem('drone-interface-layout'),'mobile');assert.equal(rule.media.mediaText,'(min-width: 0px)');assert.equal(document.querySelector('button')!.textContent,'電腦版');
    await act(()=>document.querySelector('button')!.click());assert.equal(window.localStorage.getItem('drone-interface-layout'),'desktop');assert.equal(rule.media.mediaText,'(max-width: 0px)');
  }finally{await act(()=>root.unmount());assert.equal(rule.media.mediaText,'(max-width:700px)');setInterfaceLayout('auto');dom.window.close();}
});
