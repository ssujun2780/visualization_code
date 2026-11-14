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
int main(void){N*seed=0;seed=put(seed,30);seed=put(seed,20);seed=put(seed,10);
printf("P0 %d %d %d\n",walk(seed),find(seed,10)+find(seed,30),height(seed));
seed=put(seed,25);seed=put(seed,28);printf("P1 %d %d %d\n",walk(seed),find(seed,10)+find(seed,30),height(seed));return 0;}
