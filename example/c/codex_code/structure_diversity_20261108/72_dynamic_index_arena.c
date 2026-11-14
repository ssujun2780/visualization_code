#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct{int v,next;}N;typedef struct{N*a;int len,cap;}G;
int append(G*g,int v){N*p=realloc(g->a,(g->len+1)*sizeof*p);if(!p)return 0;g->a=p;g->cap=g->len+1;int i=g->len;g->a[i].v=v;g->a[i].next=-1;if(i)g->a[i-1].next=i;g->len++;return 1;}
int main(void){G g={0};for(int i=1;i<=4;i++)if(!append(&g,i)){free(g.a);return 1;}int sum=0;for(int i=0;i!=-1;i=g.a[i].next)sum+=g.a[i].v;printf("%d\n",sum);free(g.a);return 0;}
