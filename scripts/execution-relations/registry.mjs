import {inferCalls} from './calls.mjs';
import {inferRanges} from './ranges.mjs';
import {inferCopies} from './copies.mjs';
// Event/type/provenance rules, never an algorithm-name recognizer.
export const relationPasses=Object.freeze([
  {id:'calls',analyze:inferCalls},{id:'ranges',analyze:inferRanges},{id:'copies',analyze:inferCopies}
].map(Object.freeze));
