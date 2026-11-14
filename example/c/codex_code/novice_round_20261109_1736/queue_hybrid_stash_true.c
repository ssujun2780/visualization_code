#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct Q{int data[7],used,front;int scratch[7];int*r;}Q;
void push(Q*q,int x){q->data[q->used]=x;q->used++;}
int pop(Q*q){int v=q->data[0];for(int i=1;i<q->used;i++)q->scratch[i-1]=q->data[i];q->used--;for(int i=0;i<q->used;i++)q->data[i]=q->scratch[i];return v;}
int main(void){Q q={0};q.r=q.data;for(int i=1;i<=5;i++)push(&q,i);int sum=0;while(q.used)sum=sum*10+pop(&q);q.r=q.scratch;int old=q.r[0];printf("%d %d %d\n",sum,q.used,old);return 0;}
