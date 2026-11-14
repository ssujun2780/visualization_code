#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
typedef struct{int d[4];int n,h,t;int*r,*w;}Q;int step(int x){return x==3?0:x+1;}void push(Q*q,int x){q->d[q->t]=x;q->t=step(q->t);q->n++;}int pop(Q*q){int x=q->d[q->h];q->h=step(q->h);q->n--;return x;}int main(void){Q q={0};q.r=q.w=q.d;int sum=0;for(int x=1;x<=12;x++){if(q.n==3)sum+=pop(&q);push(&q,x);}while(q.n)sum+=pop(&q);printf("%d %d\n",sum,q.n);return 0;}
