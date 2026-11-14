// Milliseconds at 1x. Transfer incidents own their time; adding operands adds
// time to the command instead of squeezing all transfers into a fixed slot.
export const incidentTiming=Object.freeze({prepare:250,emphasis:350,move:900,arrival:550,gather:650,calculate:650,apply:250,hold:900,fade:350});

export function commandTimeline(event,count,calculates) {
  const transfers=[],phases=[];
  let time=0;
  const add=(kind,duration,index)=>{const phase={kind,start:time,end:time+duration,...(index===undefined?{}:{index})};time=phase.end;phases.push(phase);return phase;};
  const changesValue=event?.kind==='WRITE'||event?.copiedFrom;
  if(count||calculates||changesValue) {
    add('prepare',incidentTiming.prepare);
    for(let index=0;index<count;index++) {
      const emphasis=add('emphasis',incidentTiming.emphasis,index),move=add('move',incidentTiming.move,index),arrival=add('arrival',incidentTiming.arrival,index);
      transfers.push({index,start:emphasis.start,moveStart:move.start,arrival:move.end,end:arrival.end});
    }
    let resultAt=0,valueAt=0;
    if(calculates){add('gather',incidentTiming.gather);resultAt=add('calculate',incidentTiming.calculate).end;}
    if(changesValue)valueAt=add('apply',incidentTiming.apply).end;
    add('hold',incidentTiming.hold);
    const fade=add('fade',incidentTiming.fade);
    return {duration:time,transfers,phases,resultAt,valueAt,effectAt:valueAt||resultAt,fade};
  }
  const duration={SPACE:1300,READ:600,CALC:2000,WRITE:700,FLOW:700,ERROR:1000}[event?.kind]??1400;
  add('prepare',duration*0.35);add('hold',duration*0.5);const fade=add('fade',duration*0.15);
  return {duration,transfers,phases,resultAt:0,valueAt:duration*0.35,effectAt:duration*0.35,fade};
}

export const timingProgress=(time,phase)=>Math.max(0,Math.min(1,(time-phase.start)/(phase.end-phase.start||1)));
