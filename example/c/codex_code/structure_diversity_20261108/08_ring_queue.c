#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct{int a[5];unsigned head,len;}Q;
static int put(Q*q,int x){if(q->len==5)return 0;unsigned at=(q->head+q->len)%5;q->a[at]=x;q->len++;return 1;}
static int take(Q*q,int*out){if(!q->len)return 0;*out=q->a[q->head];q->head=(q->head+1)%5;q->len--;return 1;}
int main(void){Q q={0};int out=0,x;for(int i=1;i<=5;i++)put(&q,i);for(int i=0;i<2;i++){take(&q,&x);out=out*10+x;}
 put(&q,6);put(&q,7);while(take(&q,&x))out=out*10+x;printf("%d\n",out);return 0;}
