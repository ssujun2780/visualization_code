#include <stdio.h>
#define INF 1000000000
int main(void){int n,m,cost[12][12],distance[12],used[12]={0};if(scanf("%d%d",&n,&m)!=2||n<1||n>12||m<0||m>60)return 1;
 for(int i=0;i<n;i++){distance[i]=INF;for(int j=0;j<n;j++)cost[i][j]=i==j?0:INF;}
 for(int i=0;i<m;i++){int a,b,w;if(scanf("%d%d%d",&a,&b,&w)!=3||a<0||a>=n||b<0||b>=n||w<0||w>20)return 1;if(w<cost[a][b])cost[a][b]=w;}
 distance[0]=0;
 for(int k=0;k<n;k++){int u=-1;for(int i=0;i<n;i++)if(!used[i]&&(u<0||distance[i]<distance[u]))u=i;if(u<0||distance[u]==INF)break;
  int selected=u; /* @trace:select */
  used[selected]=1;
  for(int v=0;v<n;v++)if(cost[selected][v]!=INF){int candidate=distance[selected]+cost[selected][v];if(candidate<distance[v]){
   distance[v]=candidate; /* @trace:relax */
  }}
 }
 for(int i=0;i<n;i++){printf("%d%c",distance[i]==INF?-1:distance[i],i+1==n?'\n':' ');}return 0;}
