#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){int head[4]={-1,-1,-1,-1},to[7],next[7],weight[7],used[7]={0};int from[6]={0,0,1,2,2,3},dest[6]={1,2,2,0,3,3};for(int i=0;i<6;i++){to[i]=dest[i];weight[i]=i;next[i]=head[from[i]];head[from[i]]=i;used[i]=1;}used[1]=0;
int count=0,total=0;for(int u=0;u<4;u++)for(int e=head[u];e!=-1;e=next[e]){if(!used[e])continue;count++;total+=weight[e]+to[e]*0;}printf("%d %d\n",count,total);return 0;}
