import fs from 'node:fs/promises';import crypto from 'node:crypto';
const dir=new URL('./',import.meta.url),manifest=JSON.parse(await fs.readFile(new URL('cases.json',dir),'utf8')),added=[];
function add(id,title,body,stdout,process,checks={},stdin=''){if(manifest.cases.some(c=>c.id===id))throw Error('Already exists');const source='#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n'+body+'\n';added.push({id,title,category:'defined-correct-inefficient',source,stdout,exitCode:0,stdin,process,checks,createdAt:new Date().toISOString(),sha256:crypto.createHash('sha256').update(source).digest('hex')});}
const left=[3,8,-2,7,4],right=[5,1,6,-3,2],indices=[4,2,0,3,1];
const expected=left.map((v,i)=>v+right[indices[i]]*2-left[4-i]);
const final=String(expected.reduce((a,b)=>a+b,0)*3)+'\n';
add('51_indirect_expression','Repeated expression through records, index table and pointer table',String.raw`
typedef struct{int value;} Node;
int main(void){Node records[5]={{3},{8},{-2},{7},{4}};int list[5]={5,1,6,-3,2},index[5]={4,2,0,3,1};Node*p[5];for(int i=0;i<5;i++)p[i]=&records[4-i];int total=0;
for(int pass=0;pass<3;pass++)for(int i=0;i<5;i++){int answer=records[i].value+list[index[i]]*2-p[i]->value;total+=answer;}printf("%d\n",total);return 0;}`,
 final,['Fifteen complete expression groups; address-index work must not replace loaded numeric leaves.','Each result checked against a saved independent JS calculation.'],{calcValues:[{expression:'records[i].value+list[index[i]]*2-p[i]->value',values:Array(3).fill(expected.map(String)).flat()}]});
add('52_helper_expression','Same expression with every read behind a function call',String.raw`
int read_at(const int*a,int i){int copy=a[i];return copy;}
int main(void){int a[5]={3,8,-2,7,4},b[5]={5,1,6,-3,2},index[5]={4,2,0,3,1},total=0;
for(int pass=0;pass<3;pass++)for(int i=0;i<5;i++){int answer=read_at(a,i)+read_at(b,index[i])*2-read_at(a,4-i);total+=answer;}printf("%d\n",total);return 0;}`,
 final,['45 real read_at calls, each returns the corresponding loaded value.','Source expression result is grouped without absorbing the function executions.'],{calls:{read_at:45},calcValues:[{expression:'read_at(a,i)+read_at(b,index[i])*2-read_at(a,4-i)',values:Array(3).fill(expected.map(String)).flat()}]});
add('53_macro_expression','Same numeric expression hidden behind an ordinary macro',String.raw`
#define COMBINE(x,y,z) ((x)+(y)*2-(z))
int main(void){int a[5]={3,8,-2,7,4},b[5]={5,1,6,-3,2},index[5]={4,2,0,3,1},total=0;
for(int pass=0;pass<3;pass++)for(int i=0;i<5;i++){int answer=COMBINE(a[i],b[index[i]],a[4-i]);total+=answer;}printf("%d\n",total);return 0;}`,
 final,['Same fifteen values as records and helper versions; macro parameter storage does not exist.','Expression grouping may display invocation or expanded source but must preserve numeric result and source location.'],{writes:[{object:'answer',values:Array(3).fill(expected.map(String)).flat()}]});
add('54_conditional_updates','Repeated short-circuit and conditional side effects',String.raw`
int hits=0;int positive(int x){hits++;return x>0;}
int main(void){int a[5]={0,2,-3,4,0},total=0;for(int pass=0;pass<2;pass++)for(int i=0;i<5;i++){int x=a[i];int ok=x!=0&&positive(x);int result=ok?(x+=2):(x-=1);total+=result;}printf("%d %d\n",total,hits);return 0;}`,
 '8 6\n',['Only three positive calls per pass; zero short-circuits and nonpositive branch decrements.','Conditional runs one update only; source arithmetic remains an observed result.'],{calls:{positive:6},writes:[{object:'result',values:['-1','4','-4','6','-1','-1','4','-4','6','-1']}]} );
add('55_unbuffered_input','Unbuffered counterpart of repeated getchar and ungetc',String.raw`
int main(void){setvbuf(stdin,NULL,_IONBF,0);int count=0,total=0,c;while((c=getchar())!='\n'){if(c==EOF)break;ungetc(c,stdin);int again=getchar();count++;total+=again-'0';}printf("%d %d\n",count,total);return 0;}`,
 '4 10\n',['Same logical reads as case 39, but host input arrives one byte at a time.','Pushback getchar must not consume another external byte.'],{calls:{getchar:9,ungetc:4}},'1234\n');
add('56_repeated_strtol','Parse each token twice with independent end pointers',String.raw`
int main(void){char s[]="17,-2,9";char*p=s;long total=0;int count=0;while(*p){char*end1;char*end2;long a=strtol(p,&end1,10);long b=strtol(p,&end2,10);if(end1!=end2)return 1;total+=a+b;count++;p=end1;if(*p==',')p++;}printf("%ld %d\n",total,count);return 0;}`,
 '48 3\n',['Six strtol calls; every end pointer aliases a distinct offset in original s.','Explicit p advancement observes commas and final null without out-of-bounds access.'],{calls:{strtol:6}});
add('57_padding_roundtrip','Whole-record copies with initialized padding bytes',String.raw`
typedef struct{char tag;int value;short count;} Record;
int main(void){Record a,b;memset(&a,0,sizeof a);a.tag='x';a.value=123;a.count=7;for(int i=0;i<4;i++){memcpy(&b,&a,sizeof a);memcpy(&a,&b,sizeof a);}printf("%c %d %d %d\n",a.tag,a.value,a.count,memcmp(&a,&b,sizeof a)==0);return 0;}`,
 'x 123 7 1\n',['All padding initialized before byte comparison; sizes may differ by ABI, values do not.','Eight complete copies remain visible despite identity.'],{calls:{memcpy:8,memcmp:1}});
add('58_switch_parser','A small decimal parser with redundant per-character copying',String.raw`
enum State{NUMBER,NEGATIVE};
int main(void){char input[]="12,-3,4;",copy[2]={0};enum State state=NUMBER;int value=0,total=0;for(int i=0;input[i];i++){copy[0]=input[i];char ch=copy[0];switch(ch){case '-':state=NEGATIVE;break;case ',':case ';':if(state==NEGATIVE)value=-value;total+=value;value=0;state=NUMBER;break;default:value=value*10+(ch-'0');break;}}printf("%d\n",total);return 0;}`,
 '13\n',['Case-label chains, breaks and default arithmetic follow actual input.','Copy buffer and separate char variable are redundant but both writes remain.'],{});
for(const c of added)await fs.writeFile(new URL(c.id+'.c',dir),c.source);manifest.cases.push(...added);await fs.writeFile(new URL('cases.json',dir),JSON.stringify(manifest,null,2)+'\n');console.log(`Saved ${added.length} predictions before execution.`);
