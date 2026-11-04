import type { BoundingBox2D,CameraSnapshot,ObjectPrediction } from './types';
export function boxIoU(a:BoundingBox2D,b:BoundingBox2D){const width=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)),height=Math.max(0,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)),intersection=width*height,union=a.width*a.height+b.width*b.height-intersection;return union>0?intersection/union:0;}
/** Read-only evaluation output; predictions never become target registrations or truth. */
export function comparePredictions(snapshot:CameraSnapshot,predictions:ObjectPrediction[]){return predictions.map(prediction=>{
  if(prediction.photo_id!==snapshot.photo_id)throw new Error('推論與 Ground Truth 必須使用同一 photo_id');
  const matches=snapshot.object_annotations.filter(a=>a.is_valid_annotation&&a.class_id===prediction.class_id&&a.bounding_box_2d).map(a=>({object_id:a.object_id,iou:boxIoU(a.bounding_box_2d!,prediction.bounding_box_2d)})).sort((a,b)=>b.iou-a.iou);
  return{prediction:structuredClone(prediction),matched_object_id:matches[0]?.iou?matches[0].object_id:null,iou:matches[0]?.iou??0};
});}
