export interface ScreenRect {x:number;y:number;width:number;height:number}
const right=(r:ScreenRect)=>r.x+r.width,bottom=(r:ScreenRect)=>r.y+r.height;
/** Largest aspect-correct image plus toolbar inside an unobstructed screen rectangle.
 * Horizontal edges enumerate obstacle boundaries; each span uses maximal vertical gaps.
 * Pure screen geometry, independent of the camera's FOV, pixels and flight model. */
export function fitCameraPreview(bounds:ScreenRect,obstacles:ScreenRect[],aspect:number,toolbar=40,gap=6):ScreenRect|null {
  if(![bounds.x,bounds.y,bounds.width,bounds.height,aspect,toolbar,gap].every(Number.isFinite)||bounds.width<=0||bounds.height<=0||aspect<=0||toolbar<0||gap<0)return null;
  const area={x:bounds.x+gap,y:bounds.y+gap,width:bounds.width-2*gap,height:bounds.height-2*gap};
  if(area.width<=0||area.height<=toolbar+2)return null;
  const blocks=obstacles.filter(r=>[r.x,r.y,r.width,r.height].every(Number.isFinite)&&r.width>0&&r.height>0).map(r=>({x:Math.max(area.x,r.x-gap),y:Math.max(area.y,r.y-gap),width:Math.min(right(area),right(r)+gap)-Math.max(area.x,r.x-gap),height:Math.min(bottom(area),bottom(r)+gap)-Math.max(area.y,r.y-gap)})).filter(r=>r.width>0&&r.height>0);
  const edges=[...new Set([area.x,right(area),...blocks.flatMap(r=>[r.x,right(r)])])].sort((a,b)=>a-b);
  let best:ScreenRect|null=null,bestArea=0,bestOffset=Infinity;
  const consider=(left:number,r:number,top:number,b:number)=>{
    const width=Math.min(r-left-2,(b-top-toolbar-2)*aspect),height=width/aspect;
    if(width<150||height<36)return;
    const candidate={x:left+(r-left-width-2)/2,y:top+(b-top-height-toolbar-2)/2,width:width+2,height:height+toolbar+2};
    const size=width*height,offset=Math.hypot(candidate.x+candidate.width/2-(area.x+area.width/2),candidate.y+candidate.height/2-(area.y+area.height/2));
    if(size>bestArea+1e-6||(Math.abs(size-bestArea)<=1e-6&&offset<bestOffset)){best=candidate;bestArea=size;bestOffset=offset;}
  };
  for(let i=0;i<edges.length-1;i++)for(let j=i+1;j<edges.length;j++){
    const left=edges[i],r=edges[j];if(r-left<152)continue;
    const intervals=blocks.filter(o=>o.x<r-1e-6&&right(o)>left+1e-6).sort((a,b)=>a.y-b.y);let top=area.y;
    for(const o of intervals){if(o.y>top)consider(left,r,top,o.y);top=Math.max(top,bottom(o));}
    if(top<bottom(area))consider(left,r,top,bottom(area));
  }
  return best;
}
