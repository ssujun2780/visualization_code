#include <stdio.h>
#include <stdlib.h>

int main(void){int a[6]={0,3,0,0,3,2};int sum=0;for(int start=0;start<6;start++){int p=start,d=0;while(p!=a[p]){d++;p=a[p];}d++;sum+=d;}printf("%d\n",sum);return 0;}
