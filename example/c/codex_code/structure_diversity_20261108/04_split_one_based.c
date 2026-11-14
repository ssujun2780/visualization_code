#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

int main(void){int v[5]={0,1,2,3,4};int n[5]={0,2,3,4,0};int i=1,sum=0;
 while(i!=0){int tmp=i;int more=v[tmp];sum=sum+more;int tmp2=n[tmp];i=tmp2;}
 printf("%d\n",sum);return 0;}
