#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
#include <stdint.h>

int main(void){unsigned rows[6]={6,8,8,16,32,0},seen=1;int queue[6]={0},front=0,back=1,sum=0;
while(front<back){int u=queue[front++];sum+=u;for(int v=0;v<6;v++)if((rows[u]&(1u<<v))&&!(seen&(1u<<v))){seen|=1u<<v;queue[back++]=v;}}
printf("%u %d\n",seen,sum);return 0;}
