import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const directory=new URL('./',import.meta.url),cases=[];
const headers='#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n';
function add(id,title,body,stdout,process,checks={},stdin=''){
 const source=headers+body+'\n';cases.push({id,title,category:'defined-correct-inefficient',source,stdout,exitCode:0,stdin,process,checks,createdAt:new Date().toISOString(),sha256:crypto.createHash('sha256').update(source).digest('hex')});
}
add('01_bubble_copy','Every pass copies the full array twice',String.raw`
int main(void){int a[5]={5,1,4,2,3},comparisons=0,swaps=0;
 for(int pass=0;pass<4;pass++){int copy[5];for(int k=0;k<5;k++)copy[k]=a[k];for(int k=0;k<5;k++)a[k]=copy[k];
  for(int j=0;j<4;j++){comparisons++;if(a[j]>a[j+1]){int temporary=a[j];a[j]=a[j+1];a[j+1]=temporary;swaps++;}}}
 for(int i=0;i<5;i++)printf("%d ",a[i]);printf("| %d %d\n",comparisons,swaps);return 0;}`,
 '1 2 3 4 5 | 16 6\n',['Six real swaps retain temporary/read/write order; 16 comparisons are not optimized away.','Four source lifetimes for copy; local temporary exists only in six executed swaps.'],{calcCounts:[{expression:'a[j]>a[j+1]',count:16}],objectCounts:{copy:4,temporary:6}});
add('02_naive_fibonacci','Exponential recursion without memoization',String.raw`
int visits=0;int fib(int n){visits++;if(n<2)return n;int left=fib(n-1);int right=fib(n-2);int answer=left+right;return answer;}
int main(void){int answer=fib(7);printf("%d %d\n",answer,visits);return 0;}`,
 '13 41\n',['41 distinct fib frames; left call completes before right call.','Repeated subproblems remain repeated source work.'],{calls:{fib:41}});
add('03_all_divisors','Primality test deliberately never exits early',String.raw`
int main(void){int count=0,total=0,checks=0;for(int n=2;n<=20;n++){int prime=1;for(int d=2;d<n;d++){int rem=n%d;checks++;if(rem==0)prime=0;}if(prime){count++;total+=n;}}
 printf("%d %d %d\n",count,total,checks);return 0;}`,
 '8 77 171\n',['171 remainder operations, including redundant checks after a divisor was found.'],{calcCounts:[{expression:'n%d',count:171}]});
add('04_grow_one_character','realloc and strcat for each character',String.raw`
int main(void){const char text[]="banana";char*p=malloc(1);if(!p)return 1;p[0]=0;
 for(int i=0;i<(int)strlen(text);i++){size_t n=strlen(p);char*q=realloc(p,n+2);if(!q){free(p);return 1;}p=q;char one[2]={text[i],0};strcat(p,one);}
 printf("%s %d\n",p,(int)strlen(p));free(p);return 0;}`,
 'banana 6\n',['Each successful realloc replaces the old allocation lifetime and updates p.','Each strcat reads its source through one and writes the destination range.'],{calls:{malloc:1,realloc:6,strcat:6,strlen:14},heapObjects:7,allHeapEnded:true});
add('05_reverse_twice','Repeated strlen and needless double reversal',String.raw`
char*rev(const char*s){int n=(int)strlen(s);char*r=malloc((size_t)n+1);if(!r)return NULL;strcpy(r,s);
 for(int i=0;i<(int)strlen(s)/2;i++){int j=(int)strlen(s)-1-i;char temp=r[i];r[i]=r[j];r[j]=temp;}return r;}
int main(void){char*a=rev("abcde");if(!a)return 1;char*b=rev(a);if(!b){free(a);return 1;}printf("%s %s\n",a,b);free(a);free(b);return 0;}`,
 'edcba abcde\n',['Two allocations survive their creating rev frames and are freed in main.','Four actual swaps across two calls; repeated strlen remains observed.'],{calls:{rev:2,strlen:12,strcpy:2},heapObjects:2,allHeapEnded:true});
add('06_matrix_scratch','Allocate a temporary vector for every dot product',String.raw`
int main(void){int a[2][3]={{1,2,3},{4,5,6}},b[3][2]={{1,0},{0,1},{1,1}},out[2][2];
 for(int i=0;i<2;i++)for(int j=0;j<2;j++){int*t=malloc(3*sizeof *t);if(!t)return 1;for(int k=0;k<3;k++)t[k]=a[i][k]*b[k][j];int sum=0;for(int k=0;k<3;k++)sum+=t[k];out[i][j]=sum;free(t);}
 printf("%d %d %d %d\n",out[0][0],out[0][1],out[1][0],out[1][1]);return 0;}`,
 '4 5 10 11\n',['Twelve multiply writes and four scratch allocations/frees remain.','Each out cell is written once after its own three-term sum.'],{calls:{malloc:4,free:4},heapObjects:4,allHeapEnded:true,calcCounts:[{expression:'a[i][k]*b[k][j]',count:12}]});
add('07_list_rewalk','Append and recompute a list sum by walking from the head',String.raw`
typedef struct Cell{int value;struct Cell*next;}Cell;
int sum(Cell*p){int s=0;while(p){s+=p->value;p=p->next;}return s;}
int main(void){Cell head={0,NULL};int input[4]={3,1,4,1},hops=0,last=0;
 for(int i=0;i<4;i++){Cell*n=malloc(sizeof *n);if(!n)return 1;n->value=input[i];n->next=NULL;Cell*p=&head;while(p->next){p=p->next;hops++;}p->next=n;last=sum(head.next);}
 printf("%d %d\n",last,hops);Cell*p=head.next;while(p){Cell*next=p->next;free(p);p=next;}return 0;}`,
 '9 6\n',['Sum traversals grow 1,2,3,4 nodes; append traversal costs six links.','A freed node is never read; next is saved first.'],{calls:{sum:4,malloc:4,free:4},heapObjects:4,allHeapEnded:true});
add('08_shift_stack','Implement a stack by shifting every element',String.raw`
int main(void){int a[8]={0},size=0,moves=0;for(int x=2;x<=8;x+=2){for(int j=size;j>0;j--){a[j]=a[j-1];moves++;}a[0]=x;size++;}
 while(size){int value=a[0];for(int j=1;j<size;j++){a[j-1]=a[j];moves++;}size--;printf("%d ",value);}printf("| %d\n",moves);return 0;}`,
 '8 6 4 2 | 12\n',['Twelve visible shift writes are retained instead of replacing code with an abstract stack operation.']);
add('09_value_roundtrips','Pass and return an entire record repeatedly',String.raw`
typedef struct{int v[4];int total;}Packet;
Packet bump(Packet p,int x){p.v[0]+=x;p.total+=p.v[0];return p;}
int main(void){Packet original={{1,2,3,4},0};Packet changed=bump(bump(original,2),3);printf("%d %d %d\n",original.v[0],changed.v[0],changed.total);return 0;}`,
 '1 6 9\n',['Copies preserve original.v[0]=1; outer call consumes the inner returned aggregate.'],{calls:{bump:2}});
add('10_jagged_copy','Build jagged rows and copy each row to scratch',String.raw`
int main(void){int**rows=malloc(2*sizeof *rows);if(!rows)return 1;for(int i=0;i<2;i++){rows[i]=calloc(3,sizeof **rows);if(!rows[i])return 1;for(int j=0;j<3;j++)rows[i][j]=i*10+j;}
 int total=0;for(int i=0;i<2;i++){int*t=malloc(3*sizeof *t);if(!t)return 1;memcpy(t,rows[i],3*sizeof *t);for(int j=0;j<3;j++)total+=t[j];free(t);}
 printf("%d\n",total);for(int i=0;i<2;i++)free(rows[i]);free(rows);return 0;}`,
 '36\n',['Two rows, one pointer array and two scratch vectors have distinct allocation identities.','Double-pointer loads and memcpy source bytes precede the sums.'],{heapObjects:5,allHeapEnded:true,calls:{memcpy:2}});
add('11_duplicate_tokens','Copy each token before converting it to a number',String.raw`
int main(void){const char*s="4,1,4,2";char*copy=malloc(strlen(s)+1);if(!copy)return 1;strcpy(copy,s);int total=0,count=0;
 char*p=strtok(copy,",");while(p){char*piece=malloc(strlen(p)+1);if(!piece){free(copy);return 1;}strcpy(piece,p);total+=atoi(piece);count++;free(piece);p=strtok(NULL,",");}
 printf("%d %d\n",total,count);free(copy);return 0;}`,
 '11 4\n',['strtok mutates the original copy; temporary pieces do not outlive free.'],{calls:{strtok:5,atoi:4,malloc:5,free:5},heapObjects:5,allHeapEnded:true});
add('12_parse_twice','Read lines and parse each number twice',String.raw`
int main(void){char line[32];int n=0,a[8]={0},total=0;if(!fgets(line,sizeof line,stdin)||sscanf(line,"%d",&n)!=1||n<0||n>8)return 1;
 for(int i=0;i<n;i++){int redundant=0;if(!fgets(line,sizeof line,stdin))return 1;if(sscanf(line,"%d",&redundant)!=1)return 1;if(sscanf(line,"%d",&a[i])!=1)return 1;total+=a[i];}
 printf("%d %d\n",n,total);return 0;}`,
 '4 9\n',['Eight element scans actually execute; their writes must not be collapsed into four.','stdin reads and sscanf memory effects precede each sum.'],{calls:{fgets:5,sscanf:9}},'4\n3\n1\n4\n1\n');

await fs.mkdir(directory,{recursive:true});
for(const c of cases)await fs.writeFile(new URL(c.id+'.c',directory),c.source);
await fs.writeFile(new URL('cases.json',directory),JSON.stringify({createdAt:new Date().toISOString(),cases},null,2));
console.log(`Saved ${cases.length} predictions before execution.`);
