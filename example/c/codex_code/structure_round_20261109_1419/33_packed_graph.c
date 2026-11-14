#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){unsigned int rows[5]={2u,4u,8u,16u,0u};for(int k=0;k<5;k++)for(int i=0;i<5;i++)if(rows[i]&(1u<<k))rows[i]|=rows[k];
int n=0;for(int i=0;i<5;i++)for(int j=0;j<5;j++)if(rows[i]&(1u<<j))n++;printf("%u %d\n",rows[0],n);return 0;}
