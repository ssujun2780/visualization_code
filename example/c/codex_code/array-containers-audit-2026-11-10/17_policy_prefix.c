#include <stdio.h>

typedef struct{int a[6];unsigned n;}Box;
void put(Box*b,int x){b->a[b->n++]=x;}
int last(Box*b){return b->a[--b->n];}
int first(Box*b){int x=b->a[0];for(unsigned k=1;k<b->n;k++)b->a[k-1]=b->a[k];b->n--;return x;}
int main(void){Box q={0};put(&q,11);put(&q,22);put(&q,33);int x=last(&q);printf("S0 %d %u\n",x,q.n);
return 0;}
