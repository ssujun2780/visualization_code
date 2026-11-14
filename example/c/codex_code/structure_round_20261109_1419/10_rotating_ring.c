#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int a[5],h,t,n;}Q;void put(Q*q,int x){q->a[q->t]=x;q->t=(q->t+1)%5;q->n++;}
int take(Q*q){int x=q->a[q->h];q->h=(q->h+1)%5;q->n--;return x;}
int main(void){Q q={{0},0,0,0};for(int i=0;i<5;i++)put(&q,i);int s=0;for(int i=0;i<3;i++)s+=take(&q);
put(&q,7);put(&q,7);while(q.n)s+=take(&q);printf("%d\n",s);return 0;}
