#include <stdio.h>

#include <string.h>
typedef struct{int a[6];unsigned n;}Box;
void put(Box*b,int v){b->a[b->n++]=v;}
int take(Box*b){int x=b->a[0];--b->n;memmove(b->a,b->a+1,b->n*sizeof b->a[0]);return x;}
int main(void){Box q={0};put(&q,7);put(&q,7);put(&q,7);int x=take(&q);put(&q,9);printf("S0 %d %u\n",x,q.n);return 0;}
