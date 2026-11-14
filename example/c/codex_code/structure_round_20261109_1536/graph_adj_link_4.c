#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
typedef struct E{int v,w;struct E*next;}E;int main(void){E pool[6]={{1,0,0},{2,0,0},{2,1,0},{3,3,0},{3,2,0},{0,3,0}},*heads[4]={0};int src[6]={0,0,1,1,2,3};for(int k=0;k<6;k++){pool[k].next=heads[src[k]];heads[src[k]]=pool+k;}int d[4];for(int i=0;i<4;i++)d[i]=i?1000:0;for(int pass=0;pass<4;pass++)for(int u=0;u<4;u++)for(E*p=heads[u];p;p=p->next)if(d[p->v]>d[u]+p->w)d[p->v]=d[u]+p->w;for(int i=0;i<4;i++)printf("%d ",d[i]);printf("\n");return 0;}
