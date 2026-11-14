#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void){int a[20]={17,3,11,3,9,0,21,8,8,4,19,2,16,1,7,13,6,12,5,10},n=20;
for(int pass=0;pass<n-1;pass++){int copy[20];memcpy(copy,a,sizeof a);memcpy(a,copy,sizeof a);for(int j=0;j<n-1;j++){if(a[j]>a[j+1]){int t=a[j];a[j]=a[j+1];a[j+1]=t;}}}
for(int i=0;i<n;i++)printf("%d%s",a[i],i+1==n?"\n":" ");return 0;}
