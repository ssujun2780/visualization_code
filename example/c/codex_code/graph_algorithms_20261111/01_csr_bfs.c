#include <stdio.h>

int offsets[7]={0,2,3,4,5,5,5},links[5]={1,2,3,3,0};
int marked[6],closed[6],queue[6],order[6];
int main(void){int h=0,t=0,n=0,out=0;
for(int seed=0;seed<6;seed++)if(!marked[seed]){
  marked[seed]=1;queue[t]=seed;t=(t+1)%6;n++;
  if(seed==0)printf("A %d %d %d\n",marked[0],closed[0],n);
  while(n){int u=queue[h];h=(h+1)%6;n--;order[out++]=u;
    for(int k=offsets[u];k<offsets[u+1];k++){int v=links[k];if(!marked[v]){marked[v]=1;queue[t]=v;t=(t+1)%6;n++;}}
    closed[u]=1;
  }
}
printf("B %d %d %d %d %d %d\n",order[0],order[1],order[2],order[3],order[4],order[5]);return 0;}
