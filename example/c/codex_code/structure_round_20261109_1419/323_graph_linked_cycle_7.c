#include <stdio.h>
typedef struct E{int to,w;struct E*next;}E;int main(void){int source[7]={0,1,2,3,4,5,6};E pool[7]={{1,2,0},{2,5,0},{3,6,0},{4,1,0},{5,3,0},{6,7,0},{0,8,0}},*heads[7]={0};for(int k=0;k<7;k++){int u=source[k];pool[k].next=heads[u];heads[u]=pool+k;}int d[7];for(int i=0;i<7;i++)d[i]=i?10000:0;
for(int pass=0;pass<7;pass++)for(int u=0;u<7;u++)for(E*p=heads[u];p;p=p->next)if(d[u]<10000&&d[p->to]>d[u]+p->w)d[p->to]=d[u]+p->w;for(int i=0;i<7;i++)printf("%d ",d[i]);printf("\n");return 0;}
