#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

int main(void){int a[12]={1,-1,2,4,3,-1,2,0,3,3,2,1};int i=0,sum=0;
 while(i!=-1){int base=i*3;int v=a[base];sum+=v;int next=a[base+2];i=next;}printf("%d\n",sum);return 0;}
