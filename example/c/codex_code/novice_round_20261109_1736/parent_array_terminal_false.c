#include <stdio.h>
#include <stdlib.h>

int main(void){int a[6]={-1,3,0,0,3,2};int sum=0;for(int start=0;start<6;start++){int p=start,d=0;while(p!=-1){d++;p=a[p];}sum+=d;}printf("%d\n",sum);return 0;}
