#include <stdio.h>

typedef struct{int a[5];unsigned n;}Box;
void put(Box*b,int x){if(b->n<5)b->a[b->n++]=x;}
int unused(Box*b){return b->a[--b->n];}
int main(void){Box q={0};put(&q,4);put(&q,4);put(&q,8);int sum=0;for(unsigned i=0;i<q.n;i++)sum+=q.a[i];printf("S0 %d %u\n",sum,q.n);return 0;}
