#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct{int in[8],out[8],ni,no;}Q;
void put(Q*q,int v){q->in[q->ni++]=v;}int take(Q*q){if(!q->no)while(q->ni)q->out[q->no++]=q->in[--q->ni];return q->out[--q->no];}
int main(void){Q q={0};put(&q,1);put(&q,2);put(&q,3);int r=take(&q);put(&q,4);while(q.ni||q.no)r=r*10+take(&q);printf("%d\n",r);return 0;}
