#include <stdio.h>
#include <stdlib.h>
int main(void){int a[4]={-2,0,0,9};int *q=calloc(8,sizeof(int));if(!q)return 1;for(int i=0;i<4;i++)q[4+i]=a[i];for(int i=3;i;i--)q[i]=q[2*i]+q[2*i+1];printf("%d ",q[1]);q[6]=5;for(int i=3;i;i/=2)q[i]=q[2*i]+q[2*i+1];printf("%d ",q[1]);free(q);return 0;}