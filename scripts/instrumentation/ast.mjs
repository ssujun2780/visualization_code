// Adapter for the pinned Clang 8 textual AST, not a C parser.
export function parseAst(dump, source, filename) {
  const bytes = Buffer.from(source, "utf8");
  const lines = [0];
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === 10) lines.push(i + 1);
  const offset = point => {
    const value = lines[point.line - 1] + point.column - 1;
    if (!Number.isInteger(value) || value < 0 || value >= bytes.length) throw new Error("AST 원본 위치를 해석할 수 없습니다.");
    return value;
  };
  const tokenEnd = start => {
    const rest = bytes.subarray(start).toString("utf8");
    const token = rest.match(/^(?:0[xX][0-9a-fA-F]+[uUlL]*|[0-9]+[uUlL]*|[a-zA-Z_][a-zA-Z0-9_]*|.)/s)?.[0];
    if (!token) throw new Error("AST 토큰 범위를 해석할 수 없습니다.");
    return start + Buffer.byteLength(token);
  };
  let currentLine = 1;
  const roots = [], stack = [];
  for (const line of dump.split("\n")) {
    const match = line.match(/^([ |`-]*)([A-Za-z]\w*)\s+(0x[0-9a-f]+)\b(.*)$/);
    if (!match) continue;
    const [, prefix, kind, address, details] = match;
    const depth = prefix.length / 2;
    if (!Number.isInteger(depth)) throw new Error("지원하지 않는 Clang AST 형식입니다.");
    const header = details.split("'")[0];
    const range = /<([^<>]+)>/.exec(header);
    const points = [];
    let lastPoint;
    for (const loc of header.matchAll(/(?:\/main\.c:|line:)(\d+):(\d+)|col:(\d+)/g)) {
      const point = { line: loc[1] ? Number(loc[1]) : currentLine, column: Number(loc[2] || loc[3]) };
      currentLine = point.line;
      lastPoint = point;
      if (range && loc.index >= range.index && loc.index < range.index + range[0].length) points.push(point);
    }
    const node = { kind, address, details, type: /'([^']+)'/.exec(details)?.[1], children: [] };
    if (points.length) {
      const start = offset(points[0]), last = offset(points.at(-1)), end = tokenEnd(last);
      node.source = { file: filename, start: { ...points[0], byte: start },
        end: { line: points.at(-1).line, column: points.at(-1).column + end - last, byte: end } };
      node.text = bytes.subarray(start, end).toString("utf8");
      node.declarationPoint = lastPoint;
    }
    if (depth === 0) roots.push(node);
    else {
      const parent = stack[depth - 1];
      if (!parent) throw new Error("Clang AST 부모 노드를 찾지 못했습니다.");
      parent.children.push(node);
    }
    stack[depth] = node;
    stack.length = depth + 1;
  }
  return roots;
}

export function validateSource(source) {
  if (Buffer.byteLength(source) > 16 * 1024) throw new Error("시제품 입력은 16KiB 이하입니다.");
  if (source.includes("\0")) throw new Error("NUL이 포함된 소스는 지원하지 않습니다.");
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, match => match.replace(/[^\r\n]/g, " "));
  if (/^\s*#/m.test(withoutComments)) throw new Error("시제품은 #include·매크로 등 전처리 지시문을 아직 지원하지 않습니다.");
}
