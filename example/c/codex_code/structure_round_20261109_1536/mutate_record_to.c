#include <stdio.h>
typedef struct{int u,v,w;} E;
int main(void){
 E edges[3]={{0,1,5},{1,2,2},{2,3,1}};
 int d[4]={0,100,100,100};
 for(int p=0;p<4;p++)for(int k=0;k<3;k++)if(d[edges[k].v]>d[edges[k].u]+edges[k].w)d[edges[k].v]=d[edges[k].u]+edges[k].w;
 printf("%d\n",d[0]+d[1]+d[2]+d[3]);
 edges[0].v=2;
 printf("%d\n",d[0]+d[1]+d[2]+d[3]);
 for(int i=0;i<4;i++)d[i]=i?100:0;
 for(int p=0;p<4;p++)for(int k=0;k<3;k++)if(d[edges[k].v]>d[edges[k].u]+edges[k].w)d[edges[k].v]=d[edges[k].u]+edges[k].w;
 printf("%d\n",d[0]+d[1]+d[2]+d[3]);
 return 0;
}
