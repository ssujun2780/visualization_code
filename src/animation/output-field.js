// Keep the whole recorded stream. Follow appended output only while the user
// is already at the end; inspecting earlier lines never pauses playback.
const shown=new WeakMap();
export function updateOutputField(element,text){
  const previous=shown.get(element);if(previous===text)return false;
  const follow=element.scrollHeight-element.clientHeight-element.scrollTop<=8;
  const appended=previous!==undefined&&text.startsWith(previous);
  element.textContent=text;shown.set(element,text);
  element.scrollTop=appended&&!follow?element.scrollTop:appended||previous===undefined?element.scrollHeight:0;
  return true;
}
