#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
typedef struct{int d[8];int n,h,t;int*r,*w;}Q;void push(Q*q,int x){q->d[q->t%8]=x;q->t++;q->n++;}int pop(Q*q){int x=q->d[q->h%8];q->h++;q->n--;return x;}int main(void){Q q={0};q.r=q.w=q.d;int sum=0;for(int x=1;x<=24;x++){if(q.n==7)sum+=pop(&q);push(&q,x);}while(q.n)sum+=pop(&q);printf("%d %d\n",sum,q.n);return 0;}
