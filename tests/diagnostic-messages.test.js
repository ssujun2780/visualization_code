import assert from 'node:assert/strict';
import {test} from 'node:test';
import {translateCompilerMessage,localizeDiagnostic,diagnosticTooltip,localizeCompilerOutput} from '../src/diagnostic-messages.ko.js';
import {parseCompilerDiagnostics} from '../src/compiler-diagnostics.js';
import {emitLLVM} from '../scripts/instrumentation/toolchain.mjs';

test('diagnostic translation preserves identifiers, types, flags, positions and raw evidence',()=>{
  const original={line:12,column:4,severity:'warning',message:"unused variable 'warning' [-Wunused-variable]"};
  const localized=localizeDiagnostic(original);
  assert.equal(localized.message,"'warning' 변수가 사용되지 않았습니다. [-Wunused-variable]");
  assert.equal(localized.originalMessage,original.message);assert.equal(localized.line,12);assert.equal(localized.column,4);
  assert.equal(localized.severity,'warning');assert.ok(localized.translated);
  assert.deepEqual(localizeDiagnostic(localized),localized,'translation is idempotent');
  assert.equal(diagnosticTooltip(localized),localized.message+'\n\n원문: '+original.message);
  assert.equal(original.message,"unused variable 'warning' [-Wunused-variable]");
  assert.equal(translateCompilerMessage("redefinition of 'x' with a different type: 'long' vs 'int'"),"'x'를 서로 다른 자료형 'long'와 'int'로 중복 정의했습니다.");
});
test('unrecognized diagnostics and existing Korean messages remain verbatim',()=>{
  for(const text of ["future diagnostic about 'unused variable'",'앞 case에서 break 없이 이 default로 실행이 이어질 수 있습니다.']){
    const item=localizeDiagnostic({message:text});assert.equal(item.message,text);assert.equal(item.originalMessage,text);
    assert.equal(item.translated,false);assert.equal(diagnosticTooltip(item),text);
  }
});
test('log translation changes diagnostic headers but preserves excerpts and caret locations',()=>{
  const source="  printf(\"unused variable 'a'\");\r\n  ^~~~\r\n";
  const input="/main.c:3:3: warning: unused variable 'a'\r\n"+source+"/main.c:1:10: fatal error: 'missing.h' file not found\n";
  const output=localizeCompilerOutput(input);
  assert.ok(output.includes("/main.c:3:3: 경고: 'a' 변수가 사용되지 않았습니다.\r\n"+source));
  assert.ok(output.includes("/main.c:1:10: 치명적 오류: 'missing.h' 헤더 파일을 찾을 수 없습니다."));
  assert.equal(localizeCompilerOutput('warning: user text\n'), 'warning: user text\n');
  assert.equal(translateCompilerMessage("expected ';' after return statement"),"return 문 뒤에 ';'가 필요합니다.");
});
test('real bundled Clang warnings and their notes receive Korean display text',async()=>{
  const source='#include <stdio.h>\nint main(void){int unused; unsigned int u=1; int s=-1; if(s<u) puts("a"); printf("%d", "text"); int x; printf("%d",x); return 0;}';
  const {diagnostics}=await emitLLVM(source),raw=parseCompilerDiagnostics(diagnostics),localized=raw.map(localizeDiagnostic);
  assert.equal(raw.filter(i=>i.severity==='warning').length,4);assert.equal(raw.filter(i=>i.severity==='note').length,1);
  assert.ok(localized.every(item=>item.translated));
  assert.ok(localized.some(item=>item.message.includes("'int'와 'unsigned int'")));
  assert.ok(localized.some(item=>item.message.includes("'x' 변수의 초기화되지 않은 값")));
  assert.ok(localized.some(item=>item.message.includes("서식이 요구하는 자료형은 'int'")));
  assert.ok(localized.every((item,i)=>item.originalMessage===raw[i].message&&item.line===raw[i].line&&item.column===raw[i].column));
});
