// The submit button acts like Enter by default. Raw/EOF submissions preserve
// the exact text; the execution API itself still receives explicit bytes.
export function inputSubmission(text,{eof=false,lineMode=true}={}) {
  return {stdin:lineMode&&!eof&&!text.endsWith('\n')?text+'\n':text,eof};
}
