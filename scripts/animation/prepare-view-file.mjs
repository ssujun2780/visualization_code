// Prepare existing recordings without executing C or rerunning inference.
// Usage: node scripts/animation/prepare-view-file.mjs execution.json inference.json output.json
// A directory containing plan.json/trace.json may replace execution.json.
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {prepareStructures} from '../../src/animation/prepared-structures.js';
import {encodePreparedStructures} from '../../src/animation/prepared-format.js';
import {readExecutionFiles} from '../shared/execution-files.mjs';
import {encodeExecution,decodeExecution} from '../shared/execution-format.mjs';
import {decodeInference} from '../inference/shared-values.mjs';
const [input,inferencePath,output]=process.argv.slice(2);
if(!output)throw new Error('execution.json(또는 폴더) inference.json output.json 경로를 지정하세요.');
const read=async p=>JSON.parse(await readFile(p,'utf8')),path=resolve(input),recording=(await stat(path)).isDirectory()?await readExecutionFiles(path,{includeObservations:false}):decodeExecution(await read(path)),
  inference=decodeInference(await read(resolve(inferencePath))),preparedScene=prepareStructures(recording.plan,recording.trace,inference);
await mkdir(dirname(resolve(output)),{recursive:true});
await writeFile(resolve(output),JSON.stringify(encodeExecution({plan:recording.plan,trace:recording.trace,preparedScene:encodePreparedStructures(preparedScene)})));
console.log(JSON.stringify({output:resolve(output),events:recording.trace.events.length,views:preparedScene.tracks.map(t=>({objectId:t.objectId,view:t.variants.auto.view,states:t.variants.auto.entries.length}))}));
