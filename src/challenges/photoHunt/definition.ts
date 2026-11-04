import type { ChallengeDefinition,SceneObject } from '../types';
import { DEFAULT_PHOTO_SCORE,type HuntTarget } from './scoring';
import { seededRandom } from '../scene';
export const HUNT_TARGETS:HuntTarget[]=[
  {object_id:'hunt-red-car',class_name:'car',display_name:'紅色汽車',target_description:'尋找住宅西側停車場的紅色汽車，建築物可能擋住視線。',spawn_candidates:[{east:-14,north:5,up:0},{east:-18,north:5,up:0}],scoring_config:{...DEFAULT_PHOTO_SCORE}},
  {object_id:'hunt-yellow-tent',class_name:'tent',display_name:'黃色帳篷',target_description:'探索東北方公園露營區，從樹木間找到黃色帳篷。',spawn_candidates:[{east:12,north:16,up:0},{east:16,north:16,up:0}],scoring_config:{...DEFAULT_PHOTO_SCORE}},
  {object_id:'hunt-blue-container',class_name:'container',display_name:'藍色貨櫃',target_description:'前往東南方貨櫃區，在其他貨櫃之間尋找藍色貨櫃。',spawn_candidates:[{east:17,north:-8,up:0},{east:17,north:-12,up:0}],scoring_config:{...DEFAULT_PHOTO_SCORE}},
];
export function selectHuntSpawns(targets:HuntTarget[],seed:number,randomize=true){const random=seededRandom(seed);return targets.map(t=>({target:t,position:{...t.spawn_candidates[randomize?Math.floor(random()*t.spawn_candidates.length):0]}}));}
const block=(id:string,east:number,north:number,width:number,depth:number,height:number,color:string):SceneObject=>({id,kind:'building',position:{east,north,up:height/2},size:{east:width,north:depth,up:height},solid:true,color});
export const TOWN_OBJECTS:SceneObject[]=[
  {id:'hunt-launch',kind:'platform',position:{east:0,north:-24,up:0},size:{east:2,north:2,up:.08},color:'#294f56',solid:false},
  block('west-shop',-16,-1,8,4,4.2,'#ba9c85'),block('west-home',-24,12,5,7,5,'#d6b89c'),block('central-office',-7,12,6,6,5.4,'#b4bfc1'),
  block('north-home',0,22,7,5,4,'#d4c5a6'),block('south-home',-15,-16,7,5,4.5,'#c7a891'),
  block('yard-rust',12,-10,2.4,8,2.5,'#ad694e'),block('yard-gray',22,-10,2.4,8,2.5,'#879a94'),block('yard-stack',24,-19,3,5,4.5,'#b99c60'),
  block('parking-wall',-16,9,8,.3,1.4,'#9d9d8d'),block('park-wall',7,18,.3,8,1.1,'#bdad8f'),
];
export const PHOTO_HUNT:ChallengeDefinition={
  id:'photo-treasure-hunt',version:'1.0.1',title:'攝影尋寶 Photo Treasure Hunt',description:'探索小鎮的停車場、公園露營區與貨櫃區，拍到紅色汽車、黃色帳篷與藍色貨櫃。三種目標各取最佳有效照片，平均分數越高越好；限時 5 分鐘。',difficulty:'intermediate',thumbnail:'/challenges/photo-treasure-hunt.svg',
  scene:{type:'photo-hunt-town',seed:985,params:{ground:'#a8b693',sky:'#c6dae5',randomize:true},environment:{wind:'calm',direction:90},objects:TOWN_OBJECTS},
  spawn:{position:{east:0,north:-24,up:0},heading:0},objectives:[{id:'treasures',title:'拍攝三種尋寶目標',order:0,type:'photo-hunt',params:{targets:HUNT_TARGETS}}],
  rules:[{id:'hunt-boundary',type:'flight-boundary',params:{radius:42,max_altitude:20}},{id:'hunt-collision',type:'collision',params:{fatal:true,penalty:0}}],
  scoring:{type:'photo-quality',params:{metric_id:'treasures',target_count:3}},allowed_control_modes:['MANUAL','AI_MISSION','MIXED'],time_limit:300,
  metadata:{experience:'photo-hunt',scoring_rules:['每張照片須遮擋可見率 ≥20%、入框率 ≥20%、實際可見面積 ≥3%。','完整入鏡 40 分、置中構圖 30 分、目標大小 30 分；三種目標各取最高分後平均。','只有挑戰進行中拍攝的照片可計分。剩餘時間與拍照次數獨立記錄。'],public_regions:[{name:'西側停車場',east:-16,north:5},{name:'東北露營區',east:14,north:16},{name:'東南貨櫃區',east:17,north:-10}],
    ai_hint:'區域中心為公開搜尋參考點，不是目標座標。goto_local 為相對起點 ENU，本關起點 (0,-24,0)。三區相對座標依序 (-16,29)、(14,40)、(17,14)，前兩區使用高度 6m，貨櫃區使用 9m，Nadir 雲台拍照；若照片無效請自行調整位置。',
    example_mission:{version:'1.2',name:'攝影尋寶：公開區域巡拍',commands:[{action:'set_speed',speed:4},{action:'takeoff',altitude:6},{action:'set_camera_view',view:'nadir',mode:'stabilized'},{action:'goto_local',x:-16,y:29,z:6},{action:'capture_photo'},{action:'goto_local',x:14,y:40,z:6},{action:'capture_photo'},{action:'goto_local',x:17,y:14,z:9},{action:'capture_photo'},{action:'return_to_launch'}]},
  },
};
