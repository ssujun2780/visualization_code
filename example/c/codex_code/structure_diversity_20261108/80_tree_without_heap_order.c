#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

int main(void){int a[7]={4,1,7,3,6,2,5},queue[7]={0},head=0,tail=1,sum=0;while(head<tail){int u=queue[head++];sum+=a[u];int l=2*u+1,r=2*u+2;if(l<7)queue[tail++]=l;if(r<7)queue[tail++]=r;}
 printf("%d\n",sum);return 0;}
