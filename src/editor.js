// Edits use original offsets so selections survive multi-line indentation.
export function tabEdit(value, start, end, outdent = false) {
  if (start === end && !outdent) {
    return { start, end, text: "\t", selectionStart: start + 1, selectionEnd: start + 1 };
  }
  const first = value.slice(0, start).lastIndexOf("\n") + 1;
  // A selection ending at the next line's beginning excludes that line.
  const last = end > start && value[end - 1] === "\n" ? end - 1 : end;
  const next = value.indexOf("\n", last);
  const limit = next === -1 ? value.length : next;
  const changes = [];
  let position = first;
  const text = value.slice(first, limit).split("\n").map(line => {
    const removed = outdent ? (line.match(/^(?:\t| {1,4})/)?.[0].length ?? 0) : 0;
    const added = outdent ? "" : "\t";
    changes.push({ position, removed, added: added.length });
    position += line.length + 1;
    return added + line.slice(removed);
  }).join("\n");
  const mapOffset = offset => {
    let mapped = offset;
    for (const change of changes) {
      if (offset >= change.position + change.removed) mapped += change.added - change.removed;
      else if (offset > change.position) mapped -= offset - change.position;
    }
    return mapped;
  };
  return { start: first, end: limit, text, selectionStart: mapOffset(start), selectionEnd: mapOffset(end) };
}

export function enterEdit(value, start, end) {
  const first = value.slice(0, start).lastIndexOf("\n") + 1;
  const before = value.slice(first, start);
  const indent = before.match(/^[\t ]*/)[0];
  const opensBlock = /\{[\t ]*$/.test(before);
  const inner = indent + (opensBlock ? "\t" : "");
  let text = "\n" + inner;
  if (opensBlock && /^[\t ]*\}/.test(value.slice(end))) {
    const spaces = value.slice(end).match(/^[\t ]*/)[0].length;
    end += spaces;
    text += "\n" + indent;
  }
  const caret = start + 1 + inner.length;
  return { start, end, text, selectionStart: caret, selectionEnd: caret };
}
