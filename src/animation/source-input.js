export const sourceStorageKey='c-animation-source-v1';
export const customSourceId='custom-source';
export const defaultAnimationSource='#include <stdio.h>\n\nint main(){\n\tprintf("Hello World!\\n");\n\treturn 0;\n}\n';

// Transfer an explicit source snapshot from the existing editor. Editing later
// does not silently change the program whose recording is being played.
export function storeAnimationSource(storage,source) {
  storage.setItem(sourceStorageKey,JSON.stringify({source}));
}

export function readAnimationSource(storage) {
  try {
    const saved=JSON.parse(storage.getItem(sourceStorageKey)??'null');
    return typeof saved?.source==='string'?saved.source:null;
  } catch {return null;}
}
