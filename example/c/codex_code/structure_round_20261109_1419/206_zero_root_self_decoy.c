#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int a[6]={0,0,1,3,3,4};int main(void){int s=0;for(int i=0;i<6;i++)s+=a[i];printf("%d\n",s);return 0;}
