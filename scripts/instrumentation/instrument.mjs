import { createHash } from "node:crypto";
import { parseAst, validateSource } from "./ast.mjs";

const runtime = String.raw`
#include <stdint.h>
#include <limits.h>
typedef char __cv_require_int32[(sizeof(int) == 4) ? 1 : -1];
typedef struct { int value; int event; } __cv_value;
extern int __cv_emit(int, int, int, unsigned, int, int)
  __attribute__((import_module("cvtrace"), import_name("emit")));
static unsigned __cv_address(const int *p) { return (unsigned)(uintptr_t)p; }
static __cv_value __cv_literal(int value) { return (__cv_value){value, 0}; }
static __cv_value __cv_read(int id, const int *p) {
  if (__cv_emit(id, 0, 0, __cv_address(p), 0, 0) < 0) __builtin_trap();
  int value = *p;
  return (__cv_value){value, __cv_emit(id, 1, value, __cv_address(p), 0, 0)};
}
static void __cv_store(int id, int *p, __cv_value input) {
  *p = input.value;
  __cv_emit(id, 1, input.value, __cv_address(p), input.event, 0);
}
static void __cv_guard(int id, int op, __cv_value a, __cv_value b) {
  int fault = 0;
  long long wide = 0;
  if ((op == '/' || op == '%') && b.value == 0) fault = 2;
  else if ((op == '/' || op == '%') && a.value == INT_MIN && b.value == -1) fault = 3;
  else {
    if (op == '+') wide = (long long)a.value + b.value;
    else if (op == '-') wide = (long long)a.value - b.value;
    else if (op == '*') wide = (long long)a.value * b.value;
    if (wide < INT_MIN || wide > INT_MAX) fault = 3;
  }
  if (fault) { __cv_emit(id, fault, 0, 0, a.event, b.event); __builtin_trap(); }
}
#define __CV_BINARY(NAME, OP) \
static __cv_value NAME(int id, __cv_value a, __cv_value b) { \
  __cv_guard(id, #OP[0], a, b); \
  int value = a.value OP b.value; \
  return (__cv_value){value, __cv_emit(id, 1, value, 0, a.event, b.event)}; \
}
__CV_BINARY(__cv_add, +)
__CV_BINARY(__cv_sub, -)
__CV_BINARY(__cv_mul, *)
__CV_BINARY(__cv_div, /)
__CV_BINARY(__cv_mod, %)
static __cv_value __cv_pos(int id, __cv_value a) {
  int value = +a.value;
  return (__cv_value){value, __cv_emit(id, 1, value, 0, a.event, 0)};
}
static __cv_value __cv_neg(int id, __cv_value a) {
  if (a.value == INT_MIN) { __cv_emit(id, 3, 0, 0, a.event, 0); __builtin_trap(); }
  int value = -a.value;
  return (__cv_value){value, __cv_emit(id, 1, value, 0, a.event, 0)};
}
`;

export function instrument(source, dump, filename = "main.c") {
  validateSource(source);
  const roots = parseAst(dump, source, filename);
  const unit = roots.find(n => n.kind === "TranslationUnitDecl");
  if (!unit) throw new Error("Clang AST가 없습니다.");
  const user = unit.children.filter(n => n.source);
  if (user.length !== 1 || user[0].kind !== "FunctionDecl" ||
      !/\bmain 'int \((?:void)?\)'/.test(user[0].details)) {
    throw new Error("시제품은 매개변수가 없는 int main 하나만 지원합니다. 전역 변수·다른 함수는 아직 지원하지 않습니다.");
  }
  const body = user[0].children.find(n => n.kind === "CompoundStmt");
  if (!body || user[0].children.length !== 1) throw new Error("지원하지 않는 main 정의입니다.");
  const hash = createHash("sha256").update(source).digest("hex");
  const plan = { schemaVersion: 1, programId: hash, source: { file: filename, sha256: hash },
    backend: { compiler: "bundled Clang 8.0.1", target: "wasm32-unknown-wasi", intBits: 32, pointerBits: 32 },
    frameId: "main#1", objects: [], instructions: [], scenes: [] };
  const declarations = new Map();
  let group = "entry";
  plan.scenes.push({ id: group, source: user[0].source, expression: "main entry" });
  const fail = node => { throw new Error(`시제품에서 지원하지 않는 구문: ${node.kind} (${filename}:${node.source?.start.line ?? "?"}). 정수 선언·대입·산술식·반환만 지원합니다.`); };
  const add = (kind, node, fields = {}) => {
    const index = plan.instructions.length + 1;
    if (index > 512) throw new Error("시제품 명령 수 제한(512개)을 초과했습니다.");
    const instruction = { id: `i${index}`, index, kind, source: node.source, sceneId: group,
      expression: node.text, ...fields };
    plan.instructions.push(instruction);
    return instruction;
  };
  const reference = instruction => ({ instructionId: instruction.id });
  const objectFor = node => {
    const id = /\bVar (0x[0-9a-f]+) '/.exec(node.details)?.[1];
    const object = declarations.get(id);
    if (!object) fail(node);
    return object;
  };
  function expression(node) {
    if (node.type !== "int") fail(node);
    if (node.kind === "IntegerLiteral") {
      const value = /'int' (\d+)\s*$/.exec(node.details)?.[1];
      if (!value || BigInt(value) > 2147483647n) fail(node);
      return { code: `__cv_literal(${value})`, ref: { constant: value, typeId: "c.int32" } };
    }
    if (node.kind === "ParenExpr") return expression(node.children[0]);
    if (node.kind === "ImplicitCastExpr") {
      if (!node.details.includes("<LValueToRValue>") || node.children[0]?.kind !== "DeclRefExpr") fail(node);
      return expression(node.children[0]);
    }
    if (node.kind === "DeclRefExpr") {
      const object = objectFor(node);
      const op = add("READ", node, { objectId: object.id, typeId: "c.int32",
        observe: ["address", "value", "previousWrite"], checks: ["alive", "initialized"] });
      return { code: `__cv_read(${op.index}, &${object.name})`, ref: reference(op) };
    }
    if (node.kind === "UnaryOperator") {
      const operator = /\bprefix '([+-])'/.exec(node.details)?.[1];
      if (!operator) fail(node);
      const input = expression(node.children[0]);
      const op = add("CALC", node, { operator: `unary${operator}`, typeId: "c.int32", operands: [input.ref], checks: ["signed-overflow"] });
      return { code: `__cv_${operator === "+" ? "pos" : "neg"}(${op.index}, ${input.code})`, ref: reference(op) };
    }
    if (node.kind === "BinaryOperator") {
      const operator = /'int' '([^']+)'/.exec(node.details)?.[1];
      const names = { "+": "add", "-": "sub", "*": "mul", "/": "div", "%": "mod" };
      if (!names[operator]) fail(node);
      const left = expression(node.children[0]), right = expression(node.children[1]);
      const op = add("CALC", node, { operator, typeId: "c.int32", operands: [left.ref, right.ref],
        checks: ["signed-overflow", ...(["/", "%"].includes(operator) ? ["zero-divisor"] : [])] });
      return { code: `__cv_${names[operator]}(${op.index}, ${left.code}, ${right.code})`, ref: reference(op) };
    }
    fail(node);
  }
  const begin = add("SPACE", user[0], { action: "frame.begin", frameId: plan.frameId });
  const enter = add("FLOW", user[0], { action: "enter", destination: "main" });
  const code = [`__cv_emit(${begin.index},1,0,0,0,0);`, `__cv_emit(${enter.index},1,0,0,0,0);`];
  function finish(node, input) {
    const ret = add("WRITE", node, { objectId: "main#1:return", typeId: "c.int32", action: "return.value", operands: [input.ref] });
    const result = [`__cv_value __cv_return_value = ${input.code};`,
      `__cv_emit(${ret.index},1,__cv_return_value.value,0,__cv_return_value.event,0);`];
    for (const object of [...plan.objects].reverse()) {
      const end = add("SPACE", node, { action: "object.end", objectId: object.id });
      result.push(`__cv_emit(${end.index},1,0,__cv_address(&${object.name}),0,0);`);
    }
    const endFrame = add("SPACE", node, { action: "frame.end", frameId: plan.frameId });
    const exit = add("FLOW", node, { action: "return", destination: "caller" });
    result.push(`__cv_emit(${endFrame.index},1,0,0,0,0);`, `__cv_emit(${exit.index},1,__cv_return_value.value,0,__cv_return_value.event,0);`, "return __cv_return_value.value;");
    return result;
  }
  let returned = false;
  for (const [index, statement] of body.children.entries()) {
    group = `scene${index + 1}`;
    plan.scenes.push({ id: group, source: statement.source, expression: statement.text });
    code.push(`#line ${statement.source.start.line} "main.c"`);
    if (statement.kind === "DeclStmt") {
      for (const declaration of statement.children) {
        if (declaration.kind !== "VarDecl" || declaration.type !== "int" || /\b(static|extern|register)\b/.test(declaration.details)) fail(declaration);
        const name = /\s([^\s']+) 'int'/.exec(declaration.details)?.[1];
        if (!name || !/^[A-Za-z_]\w*$/.test(name) || name.startsWith("__cv_") || plan.objects.some(o => o.name === name)) fail(declaration);
        const object = { id: `main#1:${name}`, declarationId: `${hash.slice(0, 16)}:${declaration.declarationPoint.line}:${declaration.declarationPoint.column}`,
          name, typeId: "c.int32", storage: "automatic", size: 4, source: declaration.source };
        declarations.set(declaration.address, object);
        plan.objects.push(object);
        const create = add("SPACE", declaration, { action: "object.begin", objectId: object.id, size: 4, initialized: false });
        code.push(`int ${name};`, `__cv_emit(${create.index},1,0,__cv_address(&${name}),0,0);`);
        if (declaration.children.length > 1) fail(declaration);
        if (declaration.children.length) {
          const input = expression(declaration.children[0]);
          const write = add("WRITE", declaration, { objectId: object.id, typeId: "c.int32", action: "initialize", operands: [input.ref] });
          code.push(`__cv_store(${write.index},&${name},${input.code});`);
        }
      }
    } else if (statement.kind === "BinaryOperator" && /'int' '='/.test(statement.details)) {
      if (statement.children[0]?.kind !== "DeclRefExpr") fail(statement);
      const object = objectFor(statement.children[0]);
      const input = expression(statement.children[1]);
      const write = add("WRITE", statement, { objectId: object.id, typeId: "c.int32", action: "assign", operands: [input.ref] });
      code.push(`__cv_store(${write.index},&${object.name},${input.code});`);
    } else if (statement.kind === "ReturnStmt") {
      if (index !== body.children.length - 1 || statement.children.length !== 1) fail(statement);
      code.push(...finish(statement, expression(statement.children[0])));
      returned = true;
    } else if (statement.kind !== "NullStmt") fail(statement);
  }
  if (!returned) {
    group = "implicit-return";
    plan.scenes.push({ id: group, source: body.source, expression: "implicit return 0" });
    code.push(...finish({ source: body.source, text: "implicit return 0" }, { code: "__cv_literal(0)", ref: { constant: "0", typeId: "c.int32" } }));
  }
  return { plan, instrumentedSource: `${runtime}\nint main(void) {\n${code.join("\n")}\n}\n` };
}
