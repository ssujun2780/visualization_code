#include <stdio.h>
#define INF 1000000000
int main(void){int n,m,a[144],b[12],z[12]={0},i,j,k,u,t=0,c=0;
 if(scanf("%d%d",&n,&m)!=2||n<1||n>12||m<0||m>60)return 1;
 for(i=0;i<n*n;i++)a[i]=INF;
 for(i=0;i<m;i++){int x,y,w;if(scanf("%d%d%d",&x,&y,&w)!=3||x<0||x>=n||y<0||y>=n||w<0||w>20)return 1;if(w<a[x*n+y]){a[x*n+y]=w;a[y*n+x]=w;}}
 for(i=0;i<n;i++)b[i]=INF;
 k=0;
again:
 if(k==n)goto finished;
 u=-1;i=0;
scan:
 if(i>=n)goto picked;
 if(!z[i]&&(u<0||b[i]<b[u]))u=i;
 i++;goto scan;
picked:
 if(b[u]==INF){b[u]=0;c++;}z[u]=1;t+=b[u];k++;j=0;
edges:
 if(j>=n)goto again;
 if(!z[j]&&a[u*n+j]<b[j])b[j]=a[u*n+j];
 j++;goto edges;
finished:
 printf("%d %d\n",t,c);return 0;}
