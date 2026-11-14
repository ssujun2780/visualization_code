#include <stdio.h>

typedef struct{int a[6];unsigned n;}Box;
void put(Box*b,int v){b->a[b->n++]=v;}
int take(Box*b){return b->a[--b->n];}
int peek(Box*b){return b->a[b->n-1];}
int main(void){Box q={0};put(&q,11);put(&q,22);put(&q,22);
int p=peek(&q);printf("S0 %d %u\n",p,q.n);
int x=take(&q);put(&q,33);int y=take(&q);printf("S1 %d %d %u\n",x,y,q.n);return 0;}
