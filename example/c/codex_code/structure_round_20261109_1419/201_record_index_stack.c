#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int value,left,right;}N;N a[5]={{4,1,2},{2,3,4},{6,-1,-1},{1,-1,-1},{3,-1,-1}};
int main(void){int stack[8],n=0,s=0;stack[n++]=0;while(n){int k=stack[--n];s+=a[k].value;if(a[k].left>=0)stack[n++]=a[k].left;if(a[k].right>=0)stack[n++]=a[k].right;}printf("%d\n",s);return 0;}
