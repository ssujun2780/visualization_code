#include <stdio.h>
typedef struct{int u,v,w;} E;
int main(void){
 int from[3]={0,1,2},to[3]={1,2,3},weight[3]={5,2,1};
 int d[4]={0,100,100,100};
 for(int p=0;p<4;p++)for(int k=0;k<3;k++)if(d[to[k]]>d[from[k]]+weight[k])d[to[k]]=d[from[k]]+weight[k];
 printf("%d\n",d[0]+d[1]+d[2]+d[3]);
 int tmp=from[0];from[0]=from[2];from[2]=tmp;
 printf("%d\n",d[0]+d[1]+d[2]+d[3]);
 from[2]=2;for(int i=0;i<4;i++)d[i]=i?100:0;
 for(int p=0;p<4;p++)for(int k=0;k<3;k++)if(d[to[k]]>d[from[k]]+weight[k])d[to[k]]=d[from[k]]+weight[k];
 printf("%d\n",d[0]+d[1]+d[2]+d[3]);
 return 0;
}
