import {it} from 'node:test';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MissionRoutePreview} from '../src/components/MissionRoutePreview';
import {PRESETS} from '../src/missions/presets';
import {ORIGIN} from '../src/missions/validate';
it('restores the square map and ordered steps without exposing mission JSON',()=>{
  const html=renderToStaticMarkup(createElement(MissionRoutePreview,{mission:PRESETS.find(p=>p.id==='square')!.mission,origin:ORIGIN}));
  assert.match(html,/航點預覽 · 10 步/);assert.match(html,/<polyline/);assert.equal((html.match(/<li /g)??[]).length,10);assert.ok(!html.includes('textarea'));assert.ok(!html.includes('&quot;action&quot;'));
});
it('shows sampled parallel curves and respects the actual launch origin and heading',()=>{
  const html=renderToStaticMarkup(createElement(MissionRoutePreview,{mission:PRESETS.find(p=>p.id==='parallel-circle')!.mission,origin:{east:4,north:5,up:0,heading:90}}));
  const points=html.match(/<polyline points="([^"]+)"/)![1].split(' ');assert.ok(points.length>60);assert.equal(points[0],'120,75');assert.match(html,/E 4.0/);
});
it('does not retain stale previews for cleared or invalid blocks',()=>{
  for(const mission of [null,{commands:[{action:'takeoff' as const,altitude:100},{action:'land' as const}]}]){
    const html=renderToStaticMarkup(createElement(MissionRoutePreview,{mission,origin:ORIGIN}));assert.ok(!html.includes('<svg'));assert.match(html,/合法積木/);
  }
});
