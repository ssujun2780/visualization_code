#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int v[5]={4,2,6,1,3},l[5]={1,3,-1,-1,-1},r[5]={2,4,-1,-1,-1};
int main(void){int stack[8],n=0,s=0;stack[n++]=0;while(n){int k=stack[--n];s+=v[k];if(l[k]>=0)stack[n++]=l[k];if(r[k]>=0)stack[n++]=r[k];}printf("%d\n",s);return 0;}
