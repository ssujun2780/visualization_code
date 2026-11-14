import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const url=new URL('cases.json',import.meta.url),suite=JSON.parse(await fs.readFile(url,'utf8'));
const added=[];
function add(id,source,stdout,process,checks={}){added.push({id,source,stdout,process,checks,createdAt:new Date().toISOString(),sha256:crypto.createHash('sha256').update(source).digest('hex')});}
add('46_errno_storage',`#include <stdio.h>
#include <stdlib.h>
#include <errno.h>
#include <limits.h>
int main(void){
 errno=0;
 char *end;
 long value=strtol("999999999999999999999999999999",&end,10);
 int range=errno==ERANGE;
 printf("%d %d %d\\n",value==LONG_MAX,range,*end==0);
 return 0;
}
`,'1 1 1\n',['strtol range error is defined library behavior: LONG_MAX, errno ERANGE, end at NUL.','errno points at library-owned persistent int storage; its initialization/write/read must be tracked, not confused with invalid C memory.']);
add('47_library_static_string',`#include <stdio.h>
#include <string.h>
int main(void){
 const char *message=strerror(0);
 int nonempty=message[0]!=0;
 printf("%d\\n",nonempty);return 0;
}
`,'1\n',['strerror returns a library-owned static string. Exact language/text not asserted.','Reading first character of valid return string must have a real observed object/value or explicit coverage gap.']);
add('48_external_record_return',`#include <stdio.h>
#include <stdlib.h>
int main(void){
 div_t result=div(-23,7);
 printf("%d %d\\n",result.quot,result.rem);return 0;
}
`,'-3 -2\n',['Library aggregate return receives quotient-3,remainder-2 through ABI return storage, source result type div_t.']);
add('49_normal_exit_callbacks',`#include <stdio.h>
#include <stdlib.h>
int state=0;
void first(void){state+=1;printf("first:%d\\n",state);}
void second(void){state+=10;printf("second:%d\\n",state);}
int main(void){
 if(atexit(first)!=0||atexit(second)!=0)return 1;
 puts("before");exit(0);
 puts("after");return 0;
}
`,'before\nsecond:10\nfirst:11\n',['Normal exit runs registered callbacks in reverse order; after is never executed.','Callback frames/calls and writes are user work even though exit is noreturn.'],{calls:{first:1,second:1}});
add('50_integer_parser_tail',`#include <stdio.h>
#include <stdlib.h>
int main(void){
 char text[]="18446744073709551615:end";char *end;
 unsigned long long n=strtoull(text,&end,10);
 printf("%llu %c %ld\\n",n,*end,(long)(end-text));
 return 0;
}
`,'18446744073709551615 : 20\n',['strtoull returns exact ULLONG_MAX and end pointer at colon offset20; no overflow, no errno dependency.']);
for(const c of added){await fs.writeFile(new URL(c.id+'.c',import.meta.url),c.source);if(suite.cases.some(x=>x.id===c.id))throw Error('Duplicate');suite.cases.push(c);}
await fs.writeFile(url,JSON.stringify(suite,null,2)+'\n');console.log(added.map(c=>c.id).join(' '));
