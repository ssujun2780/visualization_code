#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){int data[8]={0},used[8]={0};for(int x=1;x<=4;x++){for(int k=0;k<8;k++)if(!used[k]){data[k]=x;used[k]=1;break;}}int result=0;for(int pass=0;pass<4;pass++){int last=-1;for(int k=0;k<8;k++)if(used[k])last=k;if(last>=0){result=result*10+data[last];used[last]=0;}}printf("%d\n",result);return 0;}
