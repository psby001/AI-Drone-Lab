import { mkdir,writeFile } from 'node:fs/promises';
import { createChallengeCatalog } from '../src/challenges/catalog';
import { buildChallengeSchema } from '../src/challenges/schema';
const catalog=createChallengeCatalog(),directory=new URL('../public/challenges/',import.meta.url);
await mkdir(directory,{recursive:true});
await writeFile(new URL('challenge.schema.json',directory),JSON.stringify(buildChallengeSchema(catalog.rules,catalog.scoring,catalog.scenes),null,2)+'\n');
for(const definition of catalog.registry.list()){
  await writeFile(new URL(`${definition.id}.json`,directory),JSON.stringify(definition,null,2)+'\n');
  if(definition.metadata.example_mission)await writeFile(new URL(`${definition.id}-mission.json`,directory),JSON.stringify(definition.metadata.example_mission,null,2)+'\n');
}
console.log(`Challenge Schema and ${catalog.registry.list().length} definitions exported.`);
