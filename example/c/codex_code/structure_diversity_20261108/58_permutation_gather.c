#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

int main(void){int p[4]={2,0,3,1},a[4]={1,2,3,4},b[4]={0};for(int i=0;i<4;i++)b[i]=a[p[i]];int out=0;for(int i=0;i<4;i++)out=out*10+b[i];printf("%d\n",out);return 0;}
