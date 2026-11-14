#include <stdio.h>
typedef struct N{struct N*p;int v;} N;typedef struct E{N*a,*b;int cost;} E;
N*find(N*p){while(p->p!=p)p=p->p;return p;}
int main(void){N n[3];for(int i=0;i<3;i++){n[i].p=&n[i];n[i].v=i;}E e[3]={{n,n+1,4},{n+1,n+2,2},{n,n+2,8}},out[3];int count=0;
for(int i=0;i<3;i++){N*a=find(e[i].a),*b=find(e[i].b);if(a!=b){b->p=a;out[count++]=e[i];}}printf("%d %d %d\n",count,out[0].cost,out[1].cost);return 0;}