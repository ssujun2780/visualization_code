#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int a[8],b[8],na,nb;}Q;
void put(Q*q,int x){q->a[q->na++]=x;}
int get(Q*q){if(!q->nb){while(q->na)q->b[q->nb++]=q->a[--q->na];}return q->b[--q->nb];}
int main(void){Q q={0};put(&q,1);put(&q,2);put(&q,3);int s=get(&q);put(&q,4);while(q.na||q.nb)s=s*10+get(&q);printf("%d\n",s);return 0;}
