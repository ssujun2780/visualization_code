// Presentation only: retain compiler evidence, names, types, positions and flags.
// Unknown diagnostics remain verbatim instead of guessing their meaning.
const rules=[
  [/^unused variable ('.*')$/,(_,name)=>`${name} 변수가 사용되지 않았습니다.`],
  [/^unused parameter ('.*')$/,(_,name)=>`${name} 매개변수가 사용되지 않았습니다.`],
  [/^unused function ('.*')$/,(_,name)=>`${name} 함수가 사용되지 않았습니다.`],
  [/^unused label ('.*')$/,(_,name)=>`${name} 레이블이 사용되지 않았습니다.`],
  [/^unused typedef ('.*')$/,(_,name)=>`${name} 자료형 별칭이 사용되지 않았습니다.`],
  [/^variable ('.*') set but not used$/,(_,name)=>`${name} 변수에 값을 저장했지만 사용하지 않았습니다.`],
  [/^expression result unused$/,()=>`표현식의 계산 결과가 사용되지 않았습니다.`],
  [/^variable ('.*') is uninitialized when used here$/,(_,name)=>`이 위치에서 ${name} 변수의 초기화되지 않은 값을 사용합니다.`],
  [/^variable ('.*') is used uninitialized whenever 'if' condition is (true|false)$/,(_,name,truth)=>`if 조건이 ${truth==='true'?'참':'거짓'}인 경로에서 ${name} 변수의 초기화되지 않은 값을 사용합니다.`],
  [/^initialize the variable ('.*') to silence this warning$/,(_,name)=>`${name} 변수를 초기화하면 이 경고를 해결할 수 있습니다.`],
  [/^comparison of integers of different signs: ('.*') and ('.*')$/,(_,a,b)=>`부호 유무가 다른 정수형 ${a}와 ${b}를 비교합니다.`],
  [/^format specifies type ('.*') but the argument has type ('.*')$/,(_,expected,actual)=>`서식이 요구하는 자료형은 ${expected}이지만 인자의 자료형은 ${actual}입니다.`],
  [/^more '%' conversions than data arguments$/,()=>`서식의 변환 지정자 수보다 전달한 인자 수가 적습니다.`],
  [/^data argument not used by format string$/,()=>`서식 문자열에서 사용하지 않는 인자를 전달했습니다.`],
  [/^implicit conversion loses integer precision: ('.*') to ('.*')$/,(_,a,b)=>`${a}에서 ${b}로 암시적으로 변환하면서 정수 값의 일부가 손실될 수 있습니다.`],
  [/^implicit conversion changes signedness: ('.*') to ('.*')$/,(_,a,b)=>`${a}에서 ${b}로 암시적으로 변환하면서 부호 유무가 바뀝니다.`],
  [/^implicit conversion from ('.*') to ('.*') changes value from (.+) to (.+)$/,(_,a,b,x,y)=>`${a}에서 ${b}로 암시적으로 변환하면서 값이 ${x}에서 ${y}로 바뀝니다.`],
  [/^incompatible pointer types (initializing|assigning to|passing|returning) ('.*') (?:with an expression of type|from an expression of type|to parameter of type|from a function with result type) ('.*')$/,(_,action,a,b)=>`${{initializing:'초기화', 'assigning to':'대입',passing:'인자 전달',returning:'반환'}[action]}에 사용하는 포인터 자료형 ${a}와 ${b}가 호환되지 않습니다.`],
  [/^non-void function does not return a value( in all control paths)?$/,(_,paths)=>paths?'반환값이 필요한 함수에서 값을 반환하지 않는 실행 경로가 있습니다.':'반환값이 필요한 함수에서 값을 반환하지 않았습니다.'],
  [/^non-void function ('.*') should return a value(?: \[-Wreturn-type\])?$/,(_,name)=>`${name} 함수는 값을 반환해야 합니다.`],
  [/^void function ('.*') should not return a value$/,(_,name)=>`${name} 함수의 반환형은 void이므로 값을 반환할 수 없습니다.`],
  [/^division by zero is undefined$/,()=>`0으로 나누는 연산의 동작은 정의되어 있지 않습니다.`],
  [/^remainder by zero is undefined$/,()=>`0으로 나머지를 구하는 연산의 동작은 정의되어 있지 않습니다.`],
  [/^array index (.+) is past the end of the array \(which contains (.+) elements\)$/,(_,index,count)=>`배열 인덱스 ${index}가 범위를 벗어납니다. 배열의 원소 수는 ${count}개입니다.`],
  [/^unannotated fall-through between switch labels$/,()=>`의도적인 이어짐 표시 없이 다음 case 또는 default로 실행이 이어질 수 있습니다.`],
  [/^if statement has empty body$/,()=>`if 문의 본문이 비어 있습니다.`],
  [/^while loop has empty body$/,()=>`while 문의 본문이 비어 있습니다.`],
  [/^for loop has empty body$/,()=>`for 문의 본문이 비어 있습니다.`],
  [/^use of undeclared identifier ('.*')$/,(_,name)=>`선언되지 않은 식별자 ${name}를 사용했습니다.`],
  [/^implicit declaration of function ('.*') is invalid in C99$/,(_,name)=>`${name} 함수의 선언이 없습니다. C99 이후에는 함수의 암시적 선언을 허용하지 않습니다.`],
  [/^('.*') file not found$/,(_,name)=>`${name} 헤더 파일을 찾을 수 없습니다.`],
  [/^expected expression$/,()=>`표현식이 필요합니다.`],
  [/^expected identifier or '\('$/,()=>`식별자 또는 '('가 필요합니다.`],
  [/^expected ('.*')$/,(_,token)=>`${token}가 필요합니다.`],
  [/^expected ('.*') (after|before) (expression|return statement|declaration|top level declarator|struct|union|enum)$/,(_,token,where,context)=>{
    const label={expression:'표현식','return statement':'return 문',declaration:'선언','top level declarator':'최상위 선언',struct:'구조체',union:'공용체',enum:'열거형'}[context];
    return `${label} ${where==='after'?'뒤':'앞'}에 ${token}가 필요합니다.`;
  }],
  [/^redefinition of ('[^']*')$/,(_,name)=>`${name}가 중복 정의되었습니다.`],
  [/^redefinition of ('.*') with a different type: ('.*') vs ('.*')$/,(_,name,a,b)=>`${name}를 서로 다른 자료형 ${a}와 ${b}로 중복 정의했습니다.`],
  [/^conflicting types for ('.*')$/,(_,name)=>`${name}의 자료형이 이전 선언과 일치하지 않습니다.`],
  [/^previous (definition|declaration) is here$/,(_,kind)=>`이전 ${kind==='definition'?'정의':'선언'} 위치입니다.`],
  [/^to match this ('.*')$/,(_,token)=>`이 ${token}에 대응하는 기호가 필요합니다.`],
  [/^declared here$/,()=>`이 위치에서 선언되었습니다.`],
];

export function translateCompilerMessage(message){
  const suffix=/\s+(\[-W[^\]]+\])$/.exec(message),body=suffix?message.slice(0,suffix.index):message;
  for(const [pattern,format] of rules){const match=pattern.exec(body);if(match)return format(...match)+(suffix?' '+suffix[1]:'');}
  return message;
}
export function localizeDiagnostic(item){
  const originalMessage=item.originalMessage??item.message,message=translateCompilerMessage(originalMessage);
  return {...item,message,originalMessage,translated:message!==originalMessage};
}
export function diagnosticTooltip(item){
  const translated=localizeDiagnostic(item);
  return translated.translated?`${translated.message}\n\n원문: ${translated.originalMessage}`:translated.message;
}
export function localizeCompilerOutput(text){
  // Translate diagnostic headers only. Source excerpts and caret positions stay intact.
  return text.replace(/(^|\n)(\/?main\.c:\d+:\d+:\s*)(fatal error|error|warning|note):\s*([^\r\n]+)/g,
    (_,start,location,severity,message)=>`${start}${location}${{'fatal error':'치명적 오류',error:'오류',warning:'경고',note:'참고'}[severity]}: ${translateCompilerMessage(message)}`);
}
