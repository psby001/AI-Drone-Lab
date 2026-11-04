import { LIMITS, MISSION_LIMITS as M } from '../config/limits';
import { CAMERA_LIMITS as C } from '../camera/types';
const positive = (maximum: number) => ({ type: 'number', exclusiveMinimum: 0, maximum });
const variant = (action: string | string[], properties: Record<string, unknown>, required: string[]) => ({
  type: 'object', additionalProperties: false,
  properties: { action: Array.isArray(action) ? { enum: action } : { const: action }, ...properties },
  required: ['action', ...required],
});
const altitude = { type:'number',minimum:M.minAltitude,maximum:LIMITS.maxAltitude };
const localProperties = { x:{type:'number',minimum:-LIMITS.radius,maximum:LIMITS.radius},y:{type:'number',minimum:-LIMITS.radius,maximum:LIMITS.radius},z:altitude };
const gpsProperties = { latitude:{type:'number',minimum:-90,maximum:90},longitude:{type:'number',minimum:-180,maximum:180},altitude };
const waypointArray=(frame:'local'|'gps')=>({type:'array',minItems:1,maxItems:M.maxWaypoints,items:{type:'object',additionalProperties:false,properties:frame==='local'?localProperties:gpsProperties,required:frame==='local'?['x','y','z']:['latitude','longitude','altitude']}});
export const missionSchema = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://ai-drone-lab.local/mission-v1.2.schema.json',
  title: 'AI Drone Lab Mission v1.2',
  type: 'object', additionalProperties: false, required: ['commands'],
  properties: {
    version: { enum: ['1.0','1.1','1.2'] }, name: { type: 'string', minLength: 1, maxLength: M.maxNameLength },
    home:{type:'object',additionalProperties:false,properties:{latitude:gpsProperties.latitude,longitude:gpsProperties.longitude},required:['latitude','longitude']},
    commands: { type: 'array', minItems: 1, maxItems: M.maxCommands, items: { $ref: '#/definitions/command' } },
  },
  definitions: { parallelCommand:{oneOf:[
    variant(['move_forward','move_backward','move_left','move_right'],{distance:positive(LIMITS.radius*2),speed:positive(LIMITS.maxSpeed)},['distance']),
    variant(['ascend','descend'],{distance:positive(LIMITS.maxAltitude),speed:positive(LIMITS.verticalSpeed)},['distance']),
    variant('change_altitude',{altitude,speed:positive(LIMITS.verticalSpeed)},['altitude']),
    variant(['turn_left','turn_right'],{angle:positive(M.maxTurnAngle),speed:positive(LIMITS.yawSpeed)},['angle']),
    variant('set_heading',{heading:{type:'number',minimum:0,exclusiveMaximum:360},direction:{enum:['shortest','left','right']},speed:positive(LIMITS.yawSpeed)},['heading']),
  ]},command: { oneOf: [
    variant('set_camera_view',{view:{enum:['fpv','nadir','oblique','custom']},mode:{enum:['body','stabilized']}},['view']),
    variant('set_gimbal_pitch',{angle:{type:'number',minimum:C.minPitch,maximum:C.maxPitch}},['angle']),
    variant('set_gimbal_yaw',{angle:{type:'number',minimum:C.minYaw,maximum:C.maxYaw}},['angle']),
    variant(['reset_gimbal','capture_photo','start_recording','stop_recording'],{},[]),
    variant('parallel',{reference_frame:{enum:['body','start']},commands:{type:'array',minItems:2,maxItems:M.maxParallelCommands,items:{$ref:'#/definitions/parallelCommand'}}},['commands']),
    variant('takeoff', { altitude: { type: 'number', minimum: M.minAltitude, maximum: LIMITS.maxAltitude }, speed: positive(LIMITS.verticalSpeed) }, ['altitude']),
    variant('land', {}, []),
    variant(['move_forward','move_backward','move_left','move_right'], { distance: positive(LIMITS.radius * 2), speed: positive(LIMITS.maxSpeed) }, ['distance']),
    variant(['ascend','descend'], { distance: positive(LIMITS.maxAltitude), speed: positive(LIMITS.verticalSpeed) }, ['distance']),
    variant(['turn_left','turn_right'], { angle: positive(M.maxTurnAngle), speed: positive(LIMITS.yawSpeed) }, ['angle']),
    variant('hover', { duration: positive(M.maxHover) }, ['duration']),
    variant('set_speed',{speed:positive(LIMITS.maxSpeed),vertical_speed:positive(LIMITS.verticalSpeed)},['speed']),
    variant('change_altitude',{altitude,speed:positive(LIMITS.verticalSpeed)},['altitude']),
    variant('set_heading',{heading:{type:'number',minimum:0,exclusiveMaximum:360},direction:{enum:['shortest','left','right']},speed:positive(LIMITS.yawSpeed)},['heading']),
    variant('goto_local',{...localProperties,speed:positive(LIMITS.maxSpeed)},['x','y','z']),
    variant('goto_gps',{...gpsProperties,speed:positive(LIMITS.maxSpeed)},['latitude','longitude','altitude']),
    variant('follow_waypoints',{frame:{const:'local'},waypoints:waypointArray('local'),speed:positive(LIMITS.maxSpeed)},['frame','waypoints']),
    variant('follow_waypoints',{frame:{const:'gps'},waypoints:waypointArray('gps'),speed:positive(LIMITS.maxSpeed)},['frame','waypoints']),
    variant('return_to_launch',{altitude,speed:positive(LIMITS.maxSpeed)},[]),
    variant('repeat', { count: { type: 'integer', minimum: 1, maximum: M.maxRepeat }, commands: { type: 'array', minItems: 1, maxItems: M.maxCommands, items: { $ref: '#/definitions/command' } } }, ['count','commands']),
  ] } },
};
