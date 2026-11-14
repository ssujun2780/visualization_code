#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){int a[4]={4,2,3,1},i=0,j=0,m=0,swaps=0;
outer:if(i>=3)goto done;m=i;j=i+1;
scan:if(j>=4)goto exchange;if(a[j]<a[m])m=j;j++;goto scan;
exchange:{int t=a[i];a[i]=a[m];a[m]=t;swaps++;}i++;goto outer;
done:printf("%d %d %d %d | %d\n",a[0],a[1],a[2],a[3],swaps);return 0;}
