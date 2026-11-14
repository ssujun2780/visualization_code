#include <stdio.h>
#include <stdlib.h>
int main(void){int v[5]={1,2,3,4,5},l[5]={1,3,-1,-1,-1},r[5]={2,4,-1,-1,-1};int a=0,b=0;for(int i=0;i<5;i++){a+=v[i];b+=l[i]+r[i];}printf("%d %d\n",a,b);return 0;}