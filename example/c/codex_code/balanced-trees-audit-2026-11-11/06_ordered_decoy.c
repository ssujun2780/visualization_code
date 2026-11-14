#include <stdio.h>
typedef struct N{int k,height,red;struct N*a,*b;}N;N nodes[8];
int walk(N*p){return p?1+walk(p->a)+walk(p->b):0;}
int find(N*p,int k){while(p){if(k==p->k)return 1;p=k<p->k?p->a:p->b;}return 0;}
int main(void){nodes[0].k=20;nodes[1].k=10;nodes[2].k=30;nodes[0].a=&nodes[1];nodes[0].b=&nodes[2];
nodes[0].height=99;nodes[1].height=77;nodes[2].height=55;nodes[0].red=0;nodes[1].red=nodes[2].red=1;
N*seed=nodes;printf("P0 %d %d %d\n",walk(seed),find(seed,10)+find(seed,30),nodes[0].height);return 0;}
