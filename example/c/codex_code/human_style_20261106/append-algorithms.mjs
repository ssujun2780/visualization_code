import fs from 'node:fs/promises';import crypto from 'node:crypto';
const dir=new URL('./',import.meta.url),manifest=JSON.parse(await fs.readFile(new URL('cases.json',dir),'utf8')),added=[];
function add(id,title,body,stdout,process,checks={},stdin=''){if(manifest.cases.some(c=>c.id===id))throw Error('Already exists');const source='#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n'+body+'\n';added.push({id,title,category:'defined-correct-inefficient',source,stdout,exitCode:0,stdin,process,checks,createdAt:new Date().toISOString(),sha256:crypto.createHash('sha256').update(source).digest('hex')});}
add('45_decimal_many_allocations','Long decimal multiplication through many temporary strings',String.raw`
static void* allocate(size_t n){void*p=malloc(n);if(!p)exit(1);return p;}
static char* duplicate(const char*s){size_t n=strlen(s);char*p=allocate(n+1);memcpy(p,s,n+1);return p;}
static char* reversed(const char*s){size_t n=strlen(s);char*p=allocate(n+1);for(size_t i=0;i<n;i++)p[i]=s[n-1-i];p[n]=0;return p;}
static char* add(const char*a,const char*b){char*x=reversed(a),*y=reversed(b);size_t na=strlen(x),nb=strlen(y),n=na>nb?na:nb;char*t=allocate(n+2);int carry=0;size_t i=0;
 for(;i<n;i++){int left=i<na?x[i]-'0':0;int right=i<nb?y[i]-'0':0;int sum=left+right+carry;t[i]=(char)('0'+sum%10);carry=sum/10;}
 if(carry)t[i++]=(char)('0'+carry);t[i]=0;char*r=reversed(t);free(x);free(y);free(t);return r;}
static char* digit_product(const char*a,int digit){if(!digit)return duplicate("0");char*x=reversed(a);size_t n=strlen(x);char*t=allocate(n+2);int carry=0;size_t i=0;
 for(;i<n;i++){int product=(x[i]-'0')*digit+carry;t[i]=(char)('0'+product%10);carry=product/10;}
 if(carry)t[i++]=(char)('0'+carry);t[i]=0;char*r=reversed(t);free(x);free(t);return r;}
static char* shifted(const char*s,size_t places){if(s[0]=='0'&&s[1]==0)return duplicate(s);size_t n=strlen(s);char*p=allocate(n+places+1);memcpy(p,s,n);for(size_t i=0;i<places;i++)p[n+i]='0';p[n+places]=0;return p;}
static char* multiply(const char*a,const char*b){char*sum=duplicate("0");size_t n=strlen(b);for(size_t i=0;i<n;i++){char*part=digit_product(a,b[n-1-i]-'0');char*shift=shifted(part,i);char*next=add(sum,shift);free(sum);free(part);free(shift);sum=next;}return sum;}
int main(void){char a[40],b[40];if(scanf("%39s %39s",a,b)!=2)return 1;char*answer=multiply(a,b);puts(answer);free(answer);return 0;}`,
 String(3141592653589793n*2718281828459045n)+'\n',['Sixteen partial products, sixteen shifts and sixteen additions; all decimal digits are in-bounds.','Intermediate reversed buffers stay alive until consumed, returned arrays survive their function frames.','Every temporary heap allocation is eventually freed. Native output compared with independent JavaScript BigInt prediction.'],{calls:{digit_product:16,shifted:16,add:16,multiply:1},allHeapEnded:true},'3141592653589793 2718281828459045\n');
// Four equivalent sorting implementations with oracle values computed before execution.
const data=[17,3,11,3,9,0,21,8,8,4,19,2,16,1,7,13,6,12,5,10];
const sorted=[...data].sort((a,b)=>a-b),stdout=sorted.join(' ')+'\n';
const prefix=`int main(void){int a[20]={${data.join(',')}},n=20;`;
const suffix='for(int i=0;i<n;i++)printf("%d%s",a[i],i+1==n?"\\n":" ");return 0;}';
add('46_index_insertion','Indexed insertion sort with repeated key reads',prefix+String.raw`
for(int i=1;i<n;i++){int key=a[i];int j=i-1;while(j>=0&&a[j]>key){a[j+1]=a[j];j--;}a[j+1]=key;}
`+suffix,stdout,['Native and IR output compared with independent JS numeric sort.','Short circuit prevents reading a[-1]; shifted writes remain individual source assignments.']);
add('47_pointer_insertion','Pointer-based insertion sort on the same data',prefix+String.raw`
for(int i=1;i<n;i++){int key=*(a+i);int*position=a+i;while(position>a&&*(position-1)>key){*position=*(position-1);position--;}*position=key;}
`+suffix,stdout,['Same sorted result as indexed version; actual pointer reads and element-size movement retained.','position-1 is accessed only after position>a.']);
add('48_helper_insertion','Every comparison and move goes through a helper',String.raw`
int get(const int*a,int index){return a[index];}void put(int*a,int index,int value){a[index]=value;}
`+prefix+String.raw`
for(int i=1;i<n;i++){int key=get(a,i);int j=i-1;while(j>=0&&get(a,j)>key){int temporary=get(a,j);put(a,j+1,temporary);j--;}put(a,j+1,key);}
`+suffix,stdout,['Function-boundary version preserves all extra calls and temporary values.','Comparison and movement each read an element separately; no invented single read optimization.']);
add('49_full_copy_bubble','Bubble sort copies the complete array before every pass',prefix+String.raw`
for(int pass=0;pass<n-1;pass++){int copy[20];memcpy(copy,a,sizeof a);memcpy(a,copy,sizeof a);for(int j=0;j<n-1;j++){if(a[j]>a[j+1]){int t=a[j];a[j]=a[j+1];a[j+1]=t;}}}
`+suffix,stdout,['Nineteen complete redundant copy roundtrips and 361 adjacent comparisons.','Do not hide wasted work just because final output equals insertion variants.'],{calls:{memcpy:38},calcCounts:[{expression:'a[j]>a[j+1]',count:361}],objectCounts:{copy:19}});
add('50_static_ring','Return live static slots while repeatedly overwriting the ring',String.raw`
int*slot(int x){static int a[3]={0};static int next=0;a[next]=x;int*p=&a[next];next=(next+1)%3;return p;}
int main(void){int*p[6];for(int i=0;i<6;i++)p[i]=slot(i+1);int total=0;for(int i=0;i<6;i++)total+=*p[i];printf("%d %d %d %d\n",*p[0],*p[1],*p[2],total);return 0;}`,
 '4 5 6 30\n',['Only three static slots exist; pointers 0/3,1/4,2/5 alias.','Static storage outlives all six slot function frames, and later writes affect older pointers.'],{calls:{slot:6}});
for(const c of added)await fs.writeFile(new URL(c.id+'.c',dir),c.source);manifest.cases.push(...added);await fs.writeFile(new URL('cases.json',dir),JSON.stringify(manifest,null,2)+'\n');console.log(`Saved ${added.length} predictions before execution.`);
