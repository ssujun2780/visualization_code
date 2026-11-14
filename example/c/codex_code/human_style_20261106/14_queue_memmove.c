#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){int q[8]={0},n=0,total=0;for(int i=1;i<=5;i++){q[n]=i*3;n++;}while(n>0){int x=q[0];memmove(q,q+1,(size_t)(n-1)*sizeof *q);n--;total+=x;}printf("%d %d\n",total,n);return 0;}
