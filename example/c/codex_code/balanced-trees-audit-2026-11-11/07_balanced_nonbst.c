#include <stdio.h>
typedef struct N{int k,h,c;struct N*a,*b;}N;N nodes[8];
int walk(N*p){return p?1+walk(p->a)+walk(p->b):0;}
int height(N*p){if(!p)return 0;int a=height(p->a),b=height(p->b);return 1+(a>b?a:b);}
int main(void){nodes[0].k=20;nodes[1].k=30;nodes[2].k=10;nodes[0].a=&nodes[1];nodes[0].b=&nodes[2];
N*seed=nodes;printf("P0 %d %d\n",walk(seed),height(seed));return 0;}
