/** jsdom lacks SVG geometry/canvas; use deterministic measurement for UI state tests. */
export function prepareBlocklyDom(window:Window & typeof globalThis){
  Object.assign(globalThis,{Element:window.Element,HTMLElement:window.HTMLElement,SVGElement:window.SVGElement,Node:window.Node,DOMParser:window.DOMParser,XMLSerializer:window.XMLSerializer,getComputedStyle:window.getComputedStyle.bind(window),ResizeObserver:class{observe(){}disconnect(){}},requestAnimationFrame:(fn:()=>void)=>setTimeout(fn,0),cancelAnimationFrame:clearTimeout});
  window.requestAnimationFrame=(fn:FrameRequestCallback)=>setTimeout(()=>fn(0),0) as unknown as number;window.cancelAnimationFrame=clearTimeout;
  window.matchMedia??=()=>({matches:false,addEventListener(){},removeEventListener(){}}) as unknown as MediaQueryList;
  window.HTMLCanvasElement.prototype.getContext=function(){return{measureText:(text:string)=>({width:String(text).length*8})};} as never;
  Object.assign(window.SVGElement.prototype,{getBBox:()=>({x:0,y:0,width:100,height:30}),getComputedTextLength:()=>100,getScreenCTM:()=>({a:1,b:0,c:0,d:1,e:0,f:0,inverse(){return this;}})});
}
