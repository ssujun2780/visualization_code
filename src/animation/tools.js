import {calculationForEvent, dataFlowForEvent,transferPresentation} from './transfers.js';

export const TOOL_DEVICES = [
  {id: 'alu', name: '알루 · ALU', x: 18, y: 62, width: 404, height: 155, color: '#c4a2ff'},
];

export function immediateInputs(event) {
  if (!event || !['WRITE', 'CALC'].includes(event.kind)) return [];
  return (event.inputs ?? []).filter(input => {
    if (!input.value || input.executionId || input.observationId || input.objectId || input.kind === 'memory-range') return false;
    const value = input.value;
    const recorded = ['literal', 'decimal', 'signed', 'unsigned', 'number', 'address', 'bits'].some(key => value[key] !== undefined);
    const constantArgument = event.action === 'argument' && input.observationId === null && Number.isInteger(input.parameterIndex);
    return recorded && (value.literal !== undefined || /^compiler\b/.test(value.evidence ?? '') || constantArgument);
  });
}

export function toolsForEvent(event, recording) {
  return calculationForEvent(recording, event) ? ['alu'] : [];
}

const ramp = value => Math.max(0, Math.min(1, value));
const smooth = value => value * value * (3 - 2 * value);

// Tool visibility is derived from neighboring recorded tasks, so pausing,
// seeking and replaying need no independent tool-state machine.
export function toolAppearances(events, cursor, progress, recording, {inspection = false} = {}) {
  const previous = new Set(toolsForEvent(events[cursor - 1], recording));
  const next = new Set(toolsForEvent(events[cursor + 1], recording));
  return toolsForEvent(events[cursor], recording).map(id => {
    if (inspection) return {id, opacity: 1};
    const context = recording?.events && dataFlowForEvent(recording, events[cursor]).some(edge =>
      [edge.from, edge.to].some(endpoint => endpoint.kind === 'device' && endpoint.id === id));
    if (context) return {id, opacity: next.has(id) ? 1 : transferPresentation(recording,events[cursor],progress).groupOpacity};
    if(recording?.events) {
      const view=transferPresentation(recording,events[cursor],progress);
      return {id,opacity:Math.min(previous.has(id)?1:smooth(ramp(view.elapsed/180)),next.has(id)?1:view.groupOpacity)};
    }
    const arrival = previous.has(id) ? 1 : smooth(ramp(progress / 0.15));
    const departure = next.has(id) ? 1 : smooth(ramp((1 - progress) / 0.14));
    return {id, opacity: Math.min(arrival, departure)};
  });
}

export function spaceEffect(event) {
  if (event?.kind !== 'SPACE') return null;
  if (['object.begin', 'frame.begin'].includes(event.action)) return 'assemble';
  if (['object.end', 'frame.end'].includes(event.action)) return 'disassemble';
  return null;
}

