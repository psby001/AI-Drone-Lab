import { missionSchema } from '../src/missions/schema';

type Schema = Record<string, any>;
/** Derive the provider's strict structural schema from the canonical mission schema.
 * Optional fields become required nullable fields; local validation still enforces
 * all numeric, size, expanded-step and route constraints after null removal. */
function strictSchema(node: Schema): Schema {
  if(node.$ref)return {$ref:node.$ref.replace('#/definitions/','#/$defs/')};
  if(node.oneOf)return {anyOf:node.oneOf.map(strictSchema)};
  if(node.type==='object'){
    const properties:Schema={};
    for(const [key,value] of Object.entries(node.properties??{})){
      const converted=strictSchema(value as Schema);
      properties[key]=node.required?.includes(key)?converted:{anyOf:[converted,{type:'null'}]};
    }
    return {type:'object',additionalProperties:false,properties,required:Object.keys(properties)};
  }
  if(node.type==='array')return{type:'array',items:strictSchema(node.items)};
  if('const'in node)return{type:typeof node.const,enum:[node.const]};
  if(node.enum)return{type:typeof node.enum[0],enum:node.enum};
  return {type:node.type};
}
const converted=strictSchema(missionSchema);
export const aiOutputSchema = {
  type:'object',additionalProperties:false,
  properties:{
    status:{type:'string',enum:['ready','clarification','rejected']},
    message:{type:'string'},questions:{type:'array',items:{type:'string'}},
    mission:{anyOf:[converted,{type:'null'}]},
  },
  required:['status','message','questions','mission'],
  $defs:Object.fromEntries(Object.entries(missionSchema.definitions).map(([name,schema])=>[name,strictSchema(schema)])),
};
export function removeOptionalNulls(value:unknown):unknown {
  if(Array.isArray(value))return value.map(removeOptionalNulls);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==null).map(([k,v])=>[k,removeOptionalNulls(v)]));
  return value;
}
