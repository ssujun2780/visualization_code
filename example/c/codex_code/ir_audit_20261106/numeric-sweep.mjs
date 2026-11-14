import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const suiteUrl=new URL('cases.json',import.meta.url),suite=JSON.parse(await fs.readFile(suiteUrl,'utf8'));
const seeds=[0,1,7,31,127,128,199,200,250,254,255,17,63,129,201,239];
const u32=x=>BigInt.asUintN(32,x),u64=x=>BigInt.asUintN(64,x);
const writes={z:[],w:[],end:[],wide:[],truth:[],truncated:[]};let stdout='',stdin=seeds.length+'\n',total=0n;
for(let i=0;i<seeds.length;i++){
 const c=BigInt(seeds[i]),u=u32(4294967291n-1234567n*BigInt(i)),s=-BigInt(i*13+3);
 const z=u32(u32(c+u)^u32(u32(s)<<1n)),w=u32((z>>3n)+u32(s/7n-s%7n)),end=BigInt.asUintN(8,z+w),wide=u64(z<<33n)|w;
 const truth=c<200n&&(s>=-20n||end>10n)?1:0,truncated=Math.trunc(Number(c)/4+Number(s)/2);
 if(z&8n)total+=w&255n;
 stdin+=`${c} ${u} ${s}\n`;stdout+=`${z} ${w} ${end} ${wide} ${truth} ${truncated}\n`;
 for(const [k,v]of Object.entries({z,w,end,wide,truth,truncated}))writes[k].push(String(v));
}
stdout+=`total=${total}\n`;
const base=`#include <stdio.h>
#define MIX(c,u,s) (((c)+(u)) ^ ((unsigned int)(s)<<1))
int main(void){
 int count;if(scanf("%d",&count)!=1)return 1;
 unsigned int total=0;
 for(int i=0;i<count;i++){
  unsigned int input,u;int s;if(scanf("%u %u %d",&input,&u,&s)!=3)return 1;
  unsigned char c=(unsigned char)input;
  unsigned int z=(c+u)^((unsigned int)s<<1); // @write:z
  unsigned int w=(z>>3)+(unsigned int)(s/7-s%7); // @write:w
  unsigned char end=(unsigned char)(z+w); // @write:end
  unsigned long long wide=((unsigned long long)z<<33)|w; // @write:wide
  int truth=c<200&&(s>=-20||end>10); // @write:truth
  int truncated=(int)((double)c/4+(double)s/2); // @write:truncated
  if(z&8U)total+=w&255U;
  printf("%u %u %u %llu %d %d\\n",z,w,(unsigned)end,wide,truth,truncated);
 }
 printf("total=%u\\n",total);return 0;
}
`;
for(const [id,source]of [['44_numeric_sweep',base],['45_numeric_macro_sweep',base.replace('(c+u)^((unsigned int)s<<1)','MIX(c,u,s)')]]){
 const spec={id,source,stdout,stdin,checks:{writes},process:['16 preselected type-boundary inputs; expectations computed with independent BigInt modular arithmetic before compilation.','Check every z,w,end,wide,truth,truncated WRITE, not only printed result.','Unsigned wrap, signed quotient/remainder, 64-bit shifts, floating-to-int truncation, short circuit and bitmask branch in common expressions.'],createdAt:new Date().toISOString(),sha256:crypto.createHash('sha256').update(source).digest('hex')};
 if(suite.cases.some(c=>c.id===id))throw Error('Duplicate');suite.cases.push(spec);await fs.writeFile(new URL(id+'.c',import.meta.url),source);
}
await fs.writeFile(suiteUrl,JSON.stringify(suite,null,2)+'\n');console.log('44_numeric_sweep 45_numeric_macro_sweep');
