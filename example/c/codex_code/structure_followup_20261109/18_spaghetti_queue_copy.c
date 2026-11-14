#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
#include <stdint.h>

int main(void){int a[6]={2,4,6,8},n=4,sum=0;again:if(!n)goto done;int temporary[6]={0};int front=a[0];for(int i=1;i<n;i++)temporary[i-1]=a[i];for(int i=0;i<n-1;i++)a[i]=temporary[i];n--;sum+=front;goto again;done:printf("%d %d\n",sum,n);return 0;}
