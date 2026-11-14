#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){int count=0,total=0,checks=0;for(int n=2;n<=20;n++){int prime=1;for(int d=2;d<n;d++){int rem=n%d;checks++;if(rem==0)prime=0;}if(prime){count++;total+=n;}}
 printf("%d %d %d\n",count,total,checks);return 0;}
