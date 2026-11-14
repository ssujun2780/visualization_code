#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int in[5],out[5],ni,no;}Q;void push(Q*q,int x){q->in[q->ni++]=x;}int pop(Q*q){if(!q->no)while(q->ni)q->out[q->no++]=q->in[--q->ni];return q->out[--q->no];}int main(void){Q q={0};push(&q,1);push(&q,2);push(&q,3);printf("%d %d\n",q.ni,q.no);int a=pop(&q);push(&q,4);printf("%d %d %d\n",a,q.ni,q.no);int s=0;while(q.ni||q.no)s=s*10+pop(&q);printf("%d %d %d\n",s,q.ni,q.no);return 0;}
