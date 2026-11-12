import {createWriteStream} from 'node:fs';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

// Shared artifact writer: no dependency on either model.
// Stream JSON-compatible artifacts without constructing one giant string.
// Backpressure bounds the write queue; the trace itself remains in memory.
function* tokens(value,depth=0){
  if(value===null||typeof value!=='object'){yield JSON.stringify(value)??'null';return;}
  const array=Array.isArray(value),keys=array?null:Object.keys(value).filter(k=>value[k]!==undefined&&typeof value[k]!=='function'&&typeof value[k]!=='symbol'),
    length=array?value.length:keys.length;
  yield array?'[':'{';
  for(let i=0;i<length;i++){
    yield `${i?',':''}\n${'  '.repeat(depth+1)}`;
    if(!array)yield JSON.stringify(keys[i])+': ';
    yield* tokens(value[array?i:keys[i]],depth+1);
  }
  if(length)yield '\n'+'  '.repeat(depth);
  yield array?']':'}';
}
function* chunks(parts){let chunk='';for(const part of parts){chunk+=part;if(chunk.length>=65536){yield chunk;chunk='';}}if(chunk)yield chunk;yield '\n';}
export async function writeJSON(path,value){await pipeline(Readable.from(chunks(tokens(value))),createWriteStream(path));}
export async function writeJSONLines(path,events){
  function* lines(){for(const event of events)yield JSON.stringify(event)+'\n';}
  await pipeline(Readable.from(lines()),createWriteStream(path));
}
