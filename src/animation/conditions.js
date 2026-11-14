const predicates = new Set(['<', '<=', '>', '>=', '==', '!=', '!', '&&', '||', 'truth']);
const cache = new WeakMap();
export const conditionFlowActions = Object.freeze(['branch', 'conditional', 'switch', 'assert.check']);
export const isConditionFlow = event => event?.kind === 'FLOW' && conditionFlowActions.includes(event.action);

// Decode recorded boolean results only. Never compare the C operands or
// coerce their types in JavaScript; the compiler/runtime already did that.
export function recordedTruth(value) {
  if (!value) return null;
  const text = value.decimal ?? value.unsigned ?? value.signed ?? value.bits;
  if (text === '0' || text === 0 || /^0x0+$/i.test(String(text))) return false;
  if (text === '1' || text === 1 || /^0x0*1$/i.test(String(text))) return true;
  return null;
}

function sourceText(recording, source) {
  if (source?.expression) return source.expression;
  const range = source?.editorRange;
  const text = recording.plan.sourceMap?.snapshot?.text;
  if (!range || typeof text !== 'string') return '';
  // Compiler-provided editor ranges are used for labels, not C parsing.
  return text.split('\n').slice(range.startLineNumber - 1, range.endLineNumber).map((line, index, lines) =>
    line.slice(index === 0 ? range.startColumn - 1 : 0, index === lines.length - 1 ? range.endColumn - 1 : undefined)).join(' ').trim();
}

function unwrapped(node) {
  while (node && ['ImplicitCastExpr', 'ParenExpr'].includes(node.kind)) node = node.children?.[0];
  return node;
}

function build(recording, event) {
  if (!event) return null;
  if (event.kind === 'WRITE') {
    const producer = (event.inputs ?? []).map(input => recording.events.get(input.executionId)).find(source => source?.kind === 'CALC');
    return producer ? conditionForEvent(recording, producer) : null;
  }
  const definition = recording.instructions.get(event.instructionId);
  const expression = definition?.conditionSource?.expression ?? definition?.source?.expression ?? event.operator ?? '';
  if (event.action === 'switch') {
    return {mode: 'selection', expression, truth: null, parts: [], inputValues: [event.condition],
      selected: event.selection?.kind === 'case' ? `case ${event.selection.value}` : event.selection?.kind === 'default' ? 'default' : '선택 미확정'};
  }
  const flow = isConditionFlow(event);
  if (!flow && event.kind !== 'CALC') return null;
  const inputs = (event.dataInputs ?? []).map(id => recording.events.get(id)).filter(source => source?.kind === 'CALC');
  const calculation = flow ? inputs[0] : event;
  const calcDefinition = calculation && recording.instructions.get(calculation.instructionId);
  const nodes = new Map();
  const visit = node => { if (node) { nodes.set(node.nodeId, node); for (const child of node.children ?? []) visit(child); } };
  visit(calcDefinition?.expression);
  const root = unwrapped(calcDefinition?.expression);
  const operator = event.operator ?? definition?.operator;
  const predicate = flow || predicates.has(operator) || definition?.conditionTest || event.value?.cType?.encoding === 'DW_ATE_boolean';
  const assertion = event.action === 'assert.check', outcome = assertion ? event.assertion?.result ?? event.selectedOutcome : event.selectedOutcome;
  const truth = flow ? ['true', 'passed'].includes(outcome) ? true : ['false', 'failed'].includes(outcome) ? false : recordedTruth(event.condition) : predicate ? recordedTruth(event.value) : null;
  const specs = new Map((recording.plan.evaluations ?? []).map(spec => [spec.nodeId, spec]));
  const evaluations = event.evaluation ? [event.evaluation, ...event.nestedEvaluations ?? []] : calculation ? [calculation.evaluation, ...calculation.nestedEvaluations ?? []] : [];
  const parts = [];
  const seen = new Set();
  for (const evaluation of evaluations) {
    if (evaluation?.kind !== 'logical' || seen.has(evaluation.nodeId)) continue;
    seen.add(evaluation.nodeId);
    const spec = specs.get(evaluation.nodeId);
    if (!spec) continue;
    const step = calculation?.steps?.find(step => step.nodeId === evaluation.nodeId);
    const result = typeof evaluation.truth === 'boolean' ? evaluation.truth : recordedTruth(step?.value ?? (root?.nodeId === evaluation.nodeId ? calculation?.value : null));
    parts.push({expression: sourceText(recording, spec.source), operator: spec.operator, truth: result,
      operands: [{expression: sourceText(recording, spec.left?.source), truth: evaluation.leftTruth ?? null, skipped: false},
        {expression: sourceText(recording, spec.right?.source), truth: evaluation.right === 'skipped' ? null : result, skipped: evaluation.right === 'skipped'}]});
  }
  for (const step of calculation?.steps ?? []) {
    if (!predicates.has(step.operator) || ['&&', '||', 'truth'].includes(step.operator) || step.nodeId === root?.nodeId) continue;
    parts.push({expression: sourceText(recording, nodes.get(step.nodeId)?.source) || `부분 비교 ${step.operator}`, operator: step.operator, truth: recordedTruth(step.value), operands: []});
  }
  if (!predicate && !parts.length) return null;
  // LLVM's short-circuit merge can contribute an i1 true/false placeholder.
  // The recorded logical decision is already shown in parts; this is not a
  // value read from the skipped C operand and must not appear as one.
  const skippedNodes = new Set(evaluations.filter(evaluation => evaluation?.right === 'skipped').map(evaluation => evaluation.nodeId));
  const mergeConstants = new Set((calculation?.steps ?? []).filter(step => skippedNodes.has(step.nodeId)).flatMap(step =>
    (step.inputs ?? []).filter(input => !input.executionId && input.value?.type === 'i1' && ['true', 'false'].includes(input.value?.literal))
      .map(input => input.value.literal)));
  let inputValues = (event.inputs ?? []).filter(input => input.executionId || input.value?.type !== 'i1' || !mergeConstants.has(input.value?.literal))
    .map(input => input.value).filter(Boolean);
  if (flow) inputValues = calculation?.value ? [calculation.value] : (event.inputs ?? []).filter(input => input.executionId).map(input => input.value).filter(Boolean);
  return {mode: predicate ? 'predicate' : 'parts', expression, truth, parts, inputValues,
    selected: assertion ? truth === true ? '검증 통과' : truth === false ? '검증 실패' : '검증 결과 미확정' :
      flow ? `${truth === true ? '참' : truth === false ? '거짓' : '미확정'} ${event.action === 'conditional' ? '식 선택' : '경로로 진행'}` : null};
}

export function conditionForEvent(recording, event) {
  if (!event) return null;
  let events = cache.get(recording);
  if (!events) { events = new Map(); cache.set(recording, events); }
  if (!events.has(event.eventId)) events.set(event.eventId, build(recording, event));
  return events.get(event.eventId);
}
