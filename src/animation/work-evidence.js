const reasons={
  'unresolved-value-operand':'값 피연산자의 생산 사건 연결이 일부 빠져 있습니다. 기록된 값·대입·포인터 대상과 별개로, 출처를 끝까지 따라가는 연결이 부족합니다.',
  'unresolved-callee-operand':'호출 관련 피연산자의 생산 사건 연결이 부족합니다. 실제 호출·복귀·효과 기록은 유지됩니다.',
  'unresolved-address-origin':'접힌 주소 계산의 기저·인덱스 출처가 일부 연결되지 않았습니다. 관측 주소와 실제 대상은 유지합니다.',
  'unobserved-address-origin':'주소값은 관측되었지만 기저·인덱스 생산 사건이 연결되지 않았습니다.',
  'unresolved-address-operand':'주소 계산 피연산자의 출처 연결이 부족합니다. 숫자 주소로 대상을 추측하지 않습니다.',
  'unresolved-control-operand':'분기 원인 피연산자의 출처 연결이 부족합니다. 관측된 실제 분기 결과는 유지됩니다.',
  'unresolved-supplementary':'보조 출처 정보가 일부 연결되지 않았습니다.',
  'uninitialized-source':'미초기화 상태에서 읽힌 출처가 있습니다. 실제 기록 상태를 유지합니다.',
  'unobserved-memory-producer':'읽은 메모리를 만든 이전 쓰기 사건을 관측하지 못했습니다.',
  'unrecorded-value-input':'입력값에 대응하는 생산 사건이 기록되지 않았습니다.',
  'unavailable-value':'이 시점의 값 관측이 없습니다. 값을 보충하거나 추측하지 않습니다.',
  'query-budget':'현재 접근 범위 조회가 처리 한도에 도달했습니다.',
  'history-query-budget':'과거 출처 조회가 처리 한도에 도달했습니다.',
  'outside-analyzed-prefix':'이 위치가 분석된 실행 구간 밖에 있습니다.',
  'accesses-outside-analyzed-prefix':'접근 분석 구간 밖의 위치입니다.',
  'provenance-outside-analyzed-prefix':'값 출처 분석 구간 밖의 위치입니다.',
  'work-outside-analyzed-prefix':'작업 관계 분석 구간 밖의 위치입니다.',
  'analysis-output-truncated':'분석 결과가 기록 한도에서 잘렸습니다.'
};
export function workEvidence(view,{status='',available=true}={}){
  const codes=[...new Set(view.unresolved??[])],operation=view.evidenceOperation;
  const details=codes.map(code=>({code,message:reasons[code]??'이 분석 항목의 근거가 부족합니다. 원문 식별자를 보존합니다.'}));
  if(status)return {state:available?'loading':'unavailable',summary:status,details,operation};
  if(view.status==='loading')return {state:'loading',summary:'현재 위치의 작업 관계 조회 중…',details,operation};
  const provenance=codes.length&&codes.every(code=>/^unresolved-.*-operand$|^unresolved-supplementary$/.test(code));
  if(codes.length||view.status==='partial')return {state:'partial',summary:provenance?`출처 연결 ${codes.length}건 누락 · 관측된 저장소 표시`:`일부 분석 정보 부족${codes.length?` · ${codes.length}건`:''}`,details,operation};
  return null;
}
