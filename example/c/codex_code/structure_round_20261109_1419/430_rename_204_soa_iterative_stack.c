#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int q7919[5]={4,2,6,1,3},q7972[5]={1,3,-1,-1,-1},q8025[5]={2,4,-1,-1,-1};
int main(void){int stack[8],n=0,s=0;stack[n++]=0;while(n){int k=stack[--n];s+=q7919[k];if(q7972[k]>=0)stack[n++]=q7972[k];if(q8025[k]>=0)stack[n++]=q8025[k];}printf("%d\n",s);return 0;}
