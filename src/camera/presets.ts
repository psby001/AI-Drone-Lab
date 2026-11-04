import type { Mission } from '../missions/types';
/** Kept separate from flight-only presets: these require browser camera capability. */
export const CAMERA_PRESETS:{id:string;name:string;mission:Mission}[]=[
  {id:'camera-survey',name:'相機：起飛、俯拍與斜拍',mission:{version:'1.2',name:'空中攝影體驗',commands:[
    {action:'takeoff',altitude:5},{action:'set_camera_view',view:'nadir',mode:'stabilized'},{action:'capture_photo'},
    {action:'set_camera_view',view:'oblique'},{action:'set_gimbal_yaw',angle:30},{action:'capture_photo'},{action:'reset_gimbal'},{action:'land'}]}},
  {id:'camera-video',name:'相機：錄製前進與轉向',mission:{version:'1.2',name:'錄影體驗',commands:[
    {action:'takeoff',altitude:4},{action:'set_camera_view',view:'oblique',mode:'body'},{action:'start_recording'},
    {action:'move_forward',distance:4},{action:'turn_right',angle:90},{action:'stop_recording'},{action:'land'}]}}
];
