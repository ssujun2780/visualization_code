#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

int*buffer;int count,capacity;
int push(int x){if(count==capacity){int*p=realloc(buffer,(capacity+1)*sizeof*p);if(!p)return 0;buffer=p;capacity++;}buffer[count]=x;count++;return 1;}
int main(void){for(int i=1;i<=4;i++)if(!push(i)){free(buffer);return 1;}int sum=0;for(int i=0;i<count;i++)sum+=buffer[i];printf("%d %d\n",count,sum);free(buffer);return 0;}
