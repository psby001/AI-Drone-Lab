import { it } from 'node:test';
import assert from 'node:assert/strict';
import { fitCameraPreview,type ScreenRect } from '../src/camera/previewLayout';
const area=(r:ScreenRect)=>((r.width-2)*(r.height-42));
function safe(result:ScreenRect|null,bounds:ScreenRect,obstacles:ScreenRect[],gap=6){
  assert.ok(result);assert.ok(result.x>=bounds.x+gap-1e-6&&result.y>=bounds.y+gap-1e-6);assert.ok(result.x+result.width<=bounds.x+bounds.width-gap+1e-6&&result.y+result.height<=bounds.y+bounds.height-gap+1e-6);
  assert.ok(Math.abs((result.width-2)/(result.height-42)-16/9)<1e-8);
  for(const o of obstacles)assert.ok(result.x+result.width<=o.x-gap+1e-6||result.x>=o.x+o.width+gap-1e-6||result.y+result.height<=o.y-gap+1e-6||result.y>=o.y+o.height+gap-1e-6,JSON.stringify({result,obstacle:o}));
  return result;
}
it('maximizes an aspect-correct image while reserving the toolbar and border',()=>{
  const bounds={x:0,y:0,width:500,height:400},r=safe(fitCameraPreview(bounds,[],16/9),bounds,[]);assert.equal(r.width,488);assert.equal(r.height,486*9/16+42);
});
it('portrait uses all available width between telemetry, buttons and joystick labels',()=>{
  const bounds={x:8,y:78,width:374,height:758},obstacles=[{x:20,y:86,width:350,height:50},{x:20,y:142,width:88,height:40},{x:280,y:142,width:90,height:40},{x:20,y:614,width:350,height:44},{x:22,y:665,width:129,height:159},{x:239,y:665,width:129,height:159}];
  const r=safe(fitCameraPreview(bounds,obstacles,16/9),bounds,obstacles);assert.equal(r.width,362);
});
it('landscape grows into the space between both sticks without covering bottom flight actions',()=>{
  const bounds={x:8,y:44,width:828,height:341},obstacles=[{x:120,y:52,width:604,height:50},{x:20,y:48,width:90,height:40},{x:736,y:48,width:88,height:40},{x:222,y:333,width:400,height:44},{x:36,y:220,width:124,height:157},{x:684,y:220,width:124,height:157}];
  const r=safe(fitCameraPreview(bounds,obstacles,16/9),bounds,obstacles);assert.ok(r.width>300);assert.ok(r.height>200);assert.ok(r.x>160&&r.x+r.width<684);
  const expanded=[...obstacles,{x:120,y:102,width:604,height:65}],smaller=safe(fitCameraPreview(bounds,expanded,16/9),bounds,expanded);assert.ok(area(smaller)<area(r));assert.deepEqual(fitCameraPreview(bounds,[...obstacles].reverse(),16/9),r);
});
it('chooses the larger free region rather than always centering the panel',()=>{
  const r=fitCameraPreview({x:0,y:0,width:800,height:400},[{x:300,y:0,width:100,height:400}],16/9,40,0)!;assert.equal(r.width,400);assert.equal(r.x,400);
});
it('handles an obscured/too-small viewport and invalid geometry without covering controls',()=>{
  const bounds={x:0,y:0,width:400,height:300};assert.equal(fitCameraPreview(bounds,[bounds],16/9),null);assert.equal(fitCameraPreview({...bounds,width:80},[],16/9),null);assert.equal(fitCameraPreview(bounds,[],0),null);assert.equal(fitCameraPreview({...bounds,height:NaN},[],16/9),null);
});
