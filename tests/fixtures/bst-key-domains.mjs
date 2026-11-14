// Source-derived predictions; production inference never imports this module.
const headers='#include <stdio.h>\n#include <string.h>\n#include <math.h>\n';
export const keyDomainCases=[
 {id:'floating-records',stdout:'A 2\nB\nC\nD\n',source:headers+String.raw`
typedef struct N{struct N *a; double v; struct N *b;}N;
int search(N*p,double q){while(p){if(q==p->v)return 1;p=q<p->v?p->a:p->b;}return 0;}
int main(void){N n[4]={{0,8.5,0},{0,3.25,0},{0,12.75,0},{0,6.5,0}};
n[0].a=n+1;n[0].b=n+2;n[1].b=n+3;N *root=n;
printf("A %d\n",search(root,6.5)+search(root,12.75));
n[3].v=9.25;puts("B");n[3].v=6.5;puts("C");n[1].v=NAN;puts("D");return 0;}`,
  expected:{A:'satisfied-observed',B:'contradicted',C:'satisfied-observed',D:'incomplete'}},
 {id:'floating-split',stdout:'A 2\nB\n',source:headers+String.raw`
float val[3]={1.5f,-2.25f,4.75f};int l[3]={1,-1,-1},r[3]={2,-1,-1};
int lookup(int p,float q){if(p<0)return 0;if(q==val[p])return 1;return q<val[p]?lookup(l[p],q):lookup(r[p],q);}
int main(void){int root=0;printf("A %d\n",lookup(root,-2.25f)+lookup(root,4.75f));val[1]=2.25f;puts("B");return 0;}`,
  expected:{A:'satisfied-observed',B:'contradicted'}},
 {id:'string-pointer',stdout:'A 2\nB\nC\n',source:headers+String.raw`
typedef struct N{struct N *x,*y;char *v;}N;
int lookup(N*p,const char*q){while(p){int c=strcmp(q,p->v);if(c==0)return 1;p=c<0?p->x:p->y;}return 0;}
int main(void){char s0[]="m",s1[]="a",s2[]="z";N n[3]={{0,0,s0},{0,0,s1},{0,0,s2}};
n[0].x=n+1;n[0].y=n+2;N *root=n;
printf("A %d\n",lookup(root,"a")+lookup(root,"z"));s1[0]='x';puts("B");s1[0]='a';puts("C");return 0;}`,
  expected:{A:'satisfied-observed',B:'contradicted',C:'satisfied-observed'}},
 {id:'string-inline',stdout:'A 2\nB\n',source:headers+String.raw`
typedef struct N{char s[8];struct N*a,*b;}N;
int lookup(N*p,const char*q){if(!p)return 0;int c=strcmp(p->s,q);if(c==0)return 1;return c>0?lookup(p->a,q):lookup(p->b,q);}
int main(void){N n[3]={{"m",0,0},{"a",0,0},{"z",0,0}};n[0].a=n+1;n[0].b=n+2;N*root=n;
printf("A %d\n",lookup(root,"a")+lookup(root,"z"));strcpy(n[1].s,"x");puts("B");return 0;}`,
  expected:{A:'satisfied-observed',B:'contradicted'}}
];
// Keep the first prediction and unvisited-terminal fixture intact above. A
// separate positive case establishes termination through actual traversal.
export const observedKeyDomainCases=keyDomainCases.filter(c=>c.id!=='floating-split').concat([
 {...keyDomainCases[1],id:'floating-split-complete',stdout:'A 5\nB\n',source:keyDomainCases[1].source
   .replace('int main(void)', 'int walk(int p){return p<0?0:1+walk(l[p])+walk(r[p]);}\nint main(void)')
   .replace('lookup(root,-2.25f)+lookup(root,4.75f)', 'walk(root)+lookup(root,-2.25f)+lookup(root,4.75f)')},
 {id:'string-separate-records',stdout:'A 2\nB\nC\n',source:headers+String.raw`
typedef struct N{char s[4];struct N*a,*b;}N;
int lookup(N*p,const char*q){if(!p)return 0;int c=strcmp(p->s,q);if(!c)return 1;return c>0?lookup(p->a,q):lookup(p->b,q);}
int main(void){N a={"m",0,0},b={"a",0,0},c={"z",0,0};a.a=&b;a.b=&c;N*root=&a;
printf("A %d\n",lookup(root,"a")+lookup(root,"z"));b.s[0]='x';puts("B");b.s[0]='a';puts("C");return 0;}`,
  expected:{A:'satisfied-observed',B:'contradicted',C:'satisfied-observed'}},
 {id:'string-rebind',stdout:'A 2\nB\nC\n',source:headers+String.raw`
typedef struct N{const char*v;struct N*x,*y;}N;
int find(N*p,const char*q){while(p){int c=strcmp(q,p->v);if(!c)return 1;p=c<0?p->x:p->y;}return 0;}
int main(void){N n[3]={{"m",0,0},{"a",0,0},{"z",0,0}};n[0].x=n+1;n[0].y=n+2;N*root=n;
printf("A %d\n",find(root,"a")+find(root,"z"));n[1].v="x";puts("B");n[1].v="a";puts("C");return 0;}`,
  expected:{A:'satisfied-observed',B:'contradicted',C:'satisfied-observed'}},
 {id:'mixed-composite',stdout:'A 2\nB\nC\n',source:headers+String.raw`
typedef struct N{int second;struct N*a,*b;double first;}N;
int cmp(double a,int b,N*p){if(a<p->first)return -1;if(a>p->first)return 1;return (b>p->second)-(b<p->second);}
int find(N*p,double a,int b){while(p){int c=cmp(a,b,p);if(!c)return 1;p=c<0?p->a:p->b;}return 0;}
int main(void){N n[3]={{5,0,0,1.5},{9,0,0,0.5},{8,0,0,1.5}};n[0].a=n+1;n[0].b=n+2;N*root=n;
printf("A %d\n",find(root,0.5,9)+find(root,1.5,8));n[2].second=4;puts("B");n[2].second=8;puts("C");return 0;}`,
  expected:{A:'satisfied-observed',B:'contradicted',C:'satisfied-observed'}},
 {id:'string-composite',stdout:'A 2\nB\nC\n',source:headers+String.raw`
typedef struct N{const char*s;int k;struct N*a,*b;}N;
int cmp(const char*s,int k,N*p){int c=strcmp(s,p->s);if(c)return c;return (k>p->k)-(k<p->k);}
int find(N*p,const char*s,int k){while(p){int c=cmp(s,k,p);if(!c)return 1;p=c<0?p->a:p->b;}return 0;}
int main(void){N n[3]={{"m",5,0,0},{"a",9,0,0},{"m",8,0,0}};n[0].a=n+1;n[0].b=n+2;N*root=n;
printf("A %d\n",find(root,"a",9)+find(root,"m",8));n[2].k=4;puts("B");n[2].k=8;puts("C");return 0;}`,
  expected:{A:'satisfied-observed',B:'contradicted',C:'satisfied-observed'}},
 {id:'string-composite-insertion',stdout:'A 5\nB\n',source:headers+String.raw`
typedef struct N{const char*s;int k;struct N*a,*b;}N;
int cmp(N*q,N*p){int c=strcmp(q->s,p->s);if(c)return c;return (q->k>p->k)-(q->k<p->k);}
void put(N*p,N*q){while(1){int c=cmp(q,p);if(c<0){if(p->a)p=p->a;else{p->a=q;return;}}
else{if(p->b)p=p->b;else{p->b=q;return;}}}}
int walk(N*p){return p?1+walk(p->a)+walk(p->b):0;}
int main(void){N n[5]={{"m",5,0,0},{"a",9,0,0},{"m",8,0,0},{"m",1,0,0},{"m",5,0,0}};N*root=n;
put(root,n+1);put(root,n+2);put(root,n+3);put(root,n+4);printf("A %d\n",walk(root));n[3].k=5;puts("B");return 0;}`,
  expected:{A:'satisfied-observed',B:'contradicted'}},
 {id:'safe-widening',stdout:'A 2\n',source:headers+String.raw`
typedef struct N{int k;struct N*a,*b;}N;
int find(N*p,double q){while(p){if(q==p->k)return 1;p=q<p->k?p->a:p->b;}return 0;}
int main(void){N n[3]={{10,0,0},{5,0,0},{15,0,0}};n[0].a=n+1;n[0].b=n+2;N*root=n;
printf("A %d\n",find(root,5)+find(root,15));return 0;}`,
  expected:{A:'satisfied-observed'}},
 {id:'lossy-float-cast',stdout:'A 2\n',source:headers+String.raw`
typedef struct N{double k;struct N*a,*b;}N;
int find(N*p,int q){while(p){if(q==(int)p->k)return 1;p=q<(int)p->k?p->a:p->b;}return 0;}
int main(void){N n[3]={{10.5,0,0},{5.5,0,0},{15.5,0,0}};n[0].a=n+1;n[0].b=n+2;N*root=n;
printf("A %d\n",find(root,5)+find(root,15));return 0;}`,
  expected:{A:'not-checkable'}},
 {id:'strcmp-magnitude',stdout:'A 2\n',source:headers+String.raw`
typedef struct N{char*s;struct N*a,*b;}N;
int find(N*p,const char*q){while(p){int c=strcmp(q,p->s);if(!c)return 1;p=c<1?p->a:p->b;}return 0;}
int main(void){N n[3]={{"m",0,0},{"a",0,0},{"z",0,0}};n[0].a=n+1;n[0].b=n+2;N*root=n;
printf("A %d\n",find(root,"a")+find(root,"z"));return 0;}`,
  expected:{A:'not-checkable'}}
]);
