#include <stdio.h>
typedef struct E{int to,w;struct E*next;}E;int main(void){int source[11]={0,1,2,3,4,5,6,7,8,9,10};E pool[11]={{1,3,0},{2,6,0},{3,6,0},{4,6,0},{5,0,0},{6,1,0},{7,4,0},{8,6,0},{9,7,0},{10,7,0},{0,0,0}},*heads[11]={0};for(int k=0;k<11;k++){int u=source[k];pool[k].next=heads[u];heads[u]=pool+k;}int d[11];for(int i=0;i<11;i++)d[i]=i?10000:0;
for(int pass=0;pass<11;pass++)for(int u=0;u<11;u++)for(E*p=heads[u];p;p=p->next)if(d[u]<10000&&d[p->to]>d[u]+p->w)d[p->to]=d[u]+p->w;for(int i=0;i<11;i++)printf("%d ",d[i]);printf("\n");return 0;}
