#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
int main(void){int row[8]={0,2,4,6,8,10,11,12},col[12]={1,2,2,3,3,4,4,5,5,6,6,0},seen[7]={0},q[7],h=0,t=0;seen[0]=1;q[t++]=0;while(h<t){int u=q[h++];for(int k=row[u];k<row[u+1];k++){int v=col[k];if(!seen[v]){seen[v]=1;q[t++]=v;}}}printf("%d\n",t);return 0;}
