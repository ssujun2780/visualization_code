#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int map[5]={1,2,3,4,0},payload[5]={10,20,30,40,50};int main(void){int s=0;for(int i=0;i<5;i++)s+=payload[map[i]];printf("%d\n",s);return 0;}
