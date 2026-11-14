#include <stdio.h>

typedef struct{int a[5];unsigned h,t;}Box;
unsigned next(unsigned i){i++;if(i==5)i=0;return i;}
int put(Box*b,int x){unsigned k=next(b->t);if(k==b->h)return 0;b->a[b->t]=x;b->t=k;return 1;}
int take(Box*b){int x=b->a[b->h];b->h=next(b->h);return x;}
int main(void){Box q={0};put(&q,1);put(&q,2);put(&q,3);put(&q,4);int x=take(&q),y=take(&q);put(&q,5);put(&q,6);
printf("S0 %d %d %u %u\n",x,y,q.h,q.t);while(q.h!=q.t)take(&q);printf("S1 %u %u\n",q.h,q.t);return 0;}
