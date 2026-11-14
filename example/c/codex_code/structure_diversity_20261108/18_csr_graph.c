#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

int main(void){int offsets[5]={0,2,3,4,4},to[4]={1,2,3,3};int queue[4]={0},seen[4]={1,0,0,0},head=0,tail=1,sum=0;
 while(head<tail){int u=queue[head++];sum+=u;for(int e=offsets[u];e<offsets[u+1];e++){int v=to[e];if(!seen[v]){seen[v]=1;queue[tail++]=v;}}}
 printf("%d\n",sum);return 0;}
