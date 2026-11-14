#include <stdio.h>
typedef struct E{int to,w;struct E*next;}E;int main(void){int source[1]={0};E pool[1]={{1,3,0}},*heads[3]={0};for(int k=0;k<1;k++){int u=source[k];pool[k].next=heads[u];heads[u]=pool+k;}int d[3];for(int i=0;i<3;i++)d[i]=i?10000:0;
for(int pass=0;pass<3;pass++)for(int u=0;u<3;u++)for(E*p=heads[u];p;p=p->next)if(d[u]<10000&&d[p->to]>d[u]+p->w)d[p->to]=d[u]+p->w;for(int i=0;i<3;i++)printf("%d ",d[i]);printf("\n");return 0;}
