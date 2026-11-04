import type { CameraSnapshot,ObjectAnnotation } from '../../groundTruth/types';

export interface PhotoScoreConfig {
  min_visibility:number;min_in_frame:number;min_area:number;ideal_area_min:number;ideal_area_max:number;
  oversize_floor:number;visibility_points:number;composition_points:number;size_points:number;
}
export const DEFAULT_PHOTO_SCORE:PhotoScoreConfig={min_visibility:.2,min_in_frame:.2,min_area:.03,ideal_area_min:.15,ideal_area_max:.30,oversize_floor:.3,visibility_points:40,composition_points:30,size_points:30};
export interface HuntTarget {
  object_id:string;class_name:string;display_name:string;target_description:string;
  spawn_candidates:Array<{east:number;north:number;up:number}>;scoring_config:PhotoScoreConfig;
}
export interface PhotoEvaluationResult {
  photo_id:string;timestamp:number;target_id:string;is_valid:boolean;visibility_score:number;composition_score:number;
  size_score:number;total_score:number;rejection_reasons:string[];suggestions:string[];in_frame:boolean;
}
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
/** Only consumes the immutable Step 9 annotation. No projection, rays, or live pose access. */
export function evaluatePhoto(snapshot:CameraSnapshot,target:HuntTarget,running:boolean):PhotoEvaluationResult {
  const a=snapshot.object_annotations.find(a=>a.object_id===target.object_id&&a.class_name===target.class_name),c=target.scoring_config;
  const reasons:string[]=[],suggestions:string[]=[];
  if(!running)reasons.push('照片不是在挑戰進行中拍攝');
  const finite=a&&[a.visibility_ratio,a.in_frame_ratio,a.visible_area_ratio,a.normalized_center?.x,a.normalized_center?.y].every(v=>typeof v==='number'&&Number.isFinite(v));
  if(!a?.is_in_frame||!a.bounding_box_2d||!finite)reasons.push('目標未入鏡');
  if(a?.is_in_frame&&finite){
    if(a.visibility_ratio+1e-9<c.min_visibility){reasons.push('目標被遮擋');suggestions.push('目標部分被遮擋，試著換個拍攝角度。');}
    if(a.in_frame_ratio+1e-9<c.min_in_frame){reasons.push('目標超出畫面');suggestions.push('目標被裁切，試著調整雲台或稍微後退。');}
    if(a.visible_area_ratio+1e-9<c.min_area){reasons.push('目標太小');suggestions.push('目標太小，試著飛近一點。');}
    if(!a.is_valid_annotation)reasons.push('沒有足夠的有效可見取樣');
  }
  const quality=finite?photoQuality(a!,c):{visibility_score:0,composition_score:0,size_score:0};
  if(finite&&quality.composition_score<c.composition_points*.8)suggestions.push('目標偏離畫面中央，試著調整雲台。');
  if(finite&&a!.visible_area_ratio>c.ideal_area_max)suggestions.push('目標過大，稍微拉遠可改善構圖。');
  const valid=reasons.length===0,total=valid?quality.visibility_score+quality.composition_score+quality.size_score:0;
  return{photo_id:snapshot.photo_id,timestamp:snapshot.timestamp,target_id:target.object_id,is_valid:valid,...quality,total_score:Math.min(100,total),rejection_reasons:reasons,suggestions,in_frame:!!a?.is_in_frame};
}
export function photoQuality(a:Pick<ObjectAnnotation,'visibility_ratio'|'in_frame_ratio'|'visible_area_ratio'|'normalized_center'>,c:PhotoScoreConfig){
  const center=a.normalized_center??{x:0,y:0},distance=Math.hypot(center.x-.5,center.y-.5)/Math.SQRT1_2;
  const area=a.visible_area_ratio;
  // Continuous at min_area, ideal_min and ideal_max; invalid photos earn no total.
  const size=area<c.min_area?0:area<c.ideal_area_min?(area-c.min_area)/(c.ideal_area_min-c.min_area):area<=c.ideal_area_max?1:1-(1-c.oversize_floor)*(area-c.ideal_area_max)/(1-c.ideal_area_max);
  return{visibility_score:c.visibility_points*clamp(a.visibility_ratio)*clamp(a.in_frame_ratio),composition_score:c.composition_points*(1-clamp(distance)),size_score:c.size_points*clamp(size)};
}
