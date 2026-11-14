#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
typedef struct{int*d;int n,h,t;int*r,*w;}Q;void push(Q*q,int x){q->d[q->t%16]=x;q->t++;q->n++;}int pop(Q*q){int x=q->d[q->h%16];q->h++;q->n--;return x;}int main(void){Q q={0};q.d=calloc(16,sizeof(int));if(!q.d)return 1;q.r=q.w=q.d;int sum=0;for(int x=1;x<=48;x++){if(q.n==15)sum+=pop(&q);push(&q,x);}while(q.n)sum+=pop(&q);printf("%d %d\n",sum,q.n);free(q.d);return 0;}
