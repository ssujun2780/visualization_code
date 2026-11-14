import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {traceModel} from '../model/index.mjs';
import {examples} from './examples.mjs';
import {loopNavigation} from './loop-navigation.mjs';
import {astNodes} from '../model/ast.mjs';
import {analyzeRecordingWorkAsync} from './work-analysis-client.mjs';

try {
  const id = process.argv[2];
  if (!Object.hasOwn(examples, id)) throw new Error('등록되지 않은 예제입니다.');
  const inputPromise=new Promise(resolve=>process.once('message',resolve));
  const example = examples[id];
  const source = await readFile(resolve(example.file), 'utf8');
  const input=await inputPromise;
  const {plan, trace, ast, observations} = await traceModel(source, {filename: example.file, stdin: input?.stdin ?? example.stdin ?? '', timeoutMs: 25000,includeObservations:true});
  if (!plan || !trace) throw new Error('예제의 중간언어 기록을 생성하지 못했습니다.');
  const nodes=astNodes(ast??'');
  const workAnalysis=await analyzeRecordingWorkAsync(plan,trace,{nodes,observations});
  process.send({result: {plan, trace, navigation:loopNavigation(plan,{nodes,source}),workAnalysis, example: {id, ...example, stdin:input?.stdin??example.stdin??'', generatedAt: new Date().toISOString()}}}, () => process.disconnect());
} catch (error) {
  process.send({error: error.message}, () => process.disconnect());
}
