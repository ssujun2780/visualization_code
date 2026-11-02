// Non-overlapping intervals, including null writes to invalidate old origins.
export class RangeOrigins{
  constructor(){this.ranges=[];}
  set(start,size,value){
    if(!size)return;const end=start+size,r=this.ranges;let lo=0,hi=r.length;
    while(lo<hi){const mid=(lo+hi)>>1;if(r[mid].end<=start)lo=mid+1;else hi=mid;}
    const first=lo,parts=[];if(r[lo]?.start<start)parts.push({...r[lo],end:start});
    while(lo<r.length&&r[lo].start<end){const old=r[lo++];if(old.end>end)parts.push({...old,start:end});}
    if(value!=null)parts.splice(parts.length&&parts[0].start<start?1:0,0,{start,end,value});
    r.splice(first,lo-first,...parts);
    for(let i=Math.max(1,first);i<Math.min(r.length,first+parts.length+2);){
      if(r[i-1].end===r[i].start&&r[i-1].value===r[i].value){r[i-1].end=r[i].end;r.splice(i,1);}else i++;
    }
  }
  get(start,size){
    const end=start+size,result=[];let at=start,lo=0,hi=this.ranges.length;
    while(lo<hi){const m=(lo+hi)>>1;if(this.ranges[m].end<=start)lo=m+1;else hi=m;}
    for(let i=lo;i<this.ranges.length&&this.ranges[i].start<end;i++){const r=this.ranges[i];if(r.start>at)result.push({start:at,end:Math.min(r.start,end),value:null});
      result.push({start:Math.max(start,r.start),end:Math.min(end,r.end),value:r.value});at=Math.min(end,r.end);}
    if(at<end)result.push({start:at,end,value:null});return result;
  }
}
