import { missionSchema } from '../../src/missions/schema';
import type { Mission, MissionCommand } from '../../src/missions/types';
// Fixtures emulate the nullable fields required by OpenAI strict outputs.
export function wireMission(mission:Mission):unknown {
  const command=(value:MissionCommand):unknown=>{
    const schema=missionSchema.definitions.command.oneOf.find((candidate)=>{
      const properties=candidate.properties as Record<string,any>;
      return (properties.action.const===value.action||properties.action.enum?.includes(value.action))&&(!properties.frame||properties.frame.const===('frame'in value?value.frame:undefined));
    })!;
    return Object.fromEntries(Object.keys(schema.properties).map(key=>[key,key==='commands'&&(value.action==='repeat'||value.action==='parallel')?value.commands.map(command):(value as Record<string,unknown>)[key]??null]));
  };
  return {version:mission.version??'1.1',name:mission.name??'測試飛行',home:mission.home??null,commands:mission.commands.map(command)};
}
export const exampleMission:Mission={version:'1.1',commands:[{action:'takeoff',altitude:5},{action:'move_forward',distance:10},{action:'turn_right',angle:90},{action:'move_forward',distance:5},{action:'land'}]};
export const ready=(mission:Mission=exampleMission)=>({status:'ready',message:'依序起飛、前進、右轉、再前進並降落。',questions:[],mission:wireMission(mission)});
export const providerResponse=(value:unknown=ready())=>new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}]}),{status:200});
