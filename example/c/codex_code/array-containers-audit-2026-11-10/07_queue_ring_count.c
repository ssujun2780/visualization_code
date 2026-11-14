#include <stdio.h>

typedef struct{int a[5];unsigned h,n;}Box;
void put(Box*b,int x){b->a[(b->h+b->n)%5]=x;b->n++;}
int take(Box*b){int x=b->a[b->h];b->h=(b->h+1)%5;b->n--;return x;}
int main(void){Box q={0};put(&q,1);put(&q,2);put(&q,3);put(&q,4);int x=take(&q),y=take(&q);put(&q,5);put(&q,6);
printf("S0 %d %d %u\n",x,y,q.n);while(q.n)take(&q);printf("S1 %u\n",q.n);put(&q,9);printf("S2 %u %d\n",q.n,q.a[q.h]);return 0;}
