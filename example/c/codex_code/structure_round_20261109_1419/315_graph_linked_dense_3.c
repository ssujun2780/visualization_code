#include <stdio.h>
typedef struct E{int to,w;struct E*next;}E;int main(void){int source[3]={0,1,2};E pool[3]={{2,2,0},{0,2,0},{0,6,0}},*heads[3]={0};for(int k=0;k<3;k++){int u=source[k];pool[k].next=heads[u];heads[u]=pool+k;}int d[3];for(int i=0;i<3;i++)d[i]=i?10000:0;
for(int pass=0;pass<3;pass++)for(int u=0;u<3;u++)for(E*p=heads[u];p;p=p->next)if(d[u]<10000&&d[p->to]>d[u]+p->w)d[p->to]=d[u]+p->w;for(int i=0;i<3;i++)printf("%d ",d[i]);printf("\n");return 0;}
