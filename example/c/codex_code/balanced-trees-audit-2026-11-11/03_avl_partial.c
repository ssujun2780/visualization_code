#include <stdio.h>
typedef struct N {int k,h,c;struct N *a,*b;} N;
N nodes[8];int used;
int height(N*p){return p?p->h:0;}
void refresh(N*p){int a=height(p->a),b=height(p->b);p->h=1+(a>b?a:b);}
N*turn_a(N*p){N*q=p->b;p->b=q->a;q->a=p;refresh(p);refresh(q);return q;}
N*turn_b(N*p){N*q=p->a;p->a=q->b;q->b=p;refresh(p);refresh(q);return q;}
N*put(N*p,int k){if(!p){N*q=&nodes[used++];q->k=k;q->h=1;return q;}
if(k<p->k)p->a=put(p->a,k);else p->b=put(p->b,k);refresh(p);
int d=height(p->a)-height(p->b);
if(d>1){if(k>p->a->k)p->a=turn_a(p->a);return turn_b(p);}
if(d< -1){if(k<p->b->k)p->b=turn_b(p->b);return turn_a(p);}return p;}
int walk(N*p){return p?1+walk(p->a)+walk(p->b):0;}
int find(N*p,int k){while(p){if(k==p->k)return 1;p=k<p->k?p->a:p->b;}return 0;}
int actual(N*p){if(!p)return 0;int a=actual(p->a),b=actual(p->b);return 1+(a>b?a:b);}
int main(void){nodes[0].k=10;nodes[1].k=20;nodes[2].k=30;nodes[0].b=&nodes[1];nodes[1].b=&nodes[2];nodes[0].h=3;nodes[1].h=2;nodes[2].h=1;
N*seed=nodes;int d=actual(seed->a)-actual(seed->b);printf("P0 %d %d %d\n",walk(seed),find(seed,0)+find(seed,30),d);
if(d< -1){N*q=seed->b;seed->b=q->a;q->a=seed;seed=q;}
printf("P1 %d %d %d\n",walk(seed),find(seed,10)+find(seed,30),nodes[0].h);
refresh(seed->a);refresh(seed);printf("P2 %d %d %d\n",walk(seed),find(seed,10)+find(seed,30),nodes[0].h);return 0;}
