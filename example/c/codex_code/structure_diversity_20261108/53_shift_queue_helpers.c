#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct{int a[8],used;}Q;
void push(Q*q,int x){q->a[q->used]=x;q->used++;}int pop(Q*q){int v=q->a[0];for(int i=1;i<q->used;i++)q->a[i-1]=q->a[i];q->used--;return v;}
int main(void){Q q={0};for(int i=1;i<=3;i++)push(&q,i);int out=0;while(q.used)out=out*10+pop(&q);printf("%d\n",out);return 0;}
