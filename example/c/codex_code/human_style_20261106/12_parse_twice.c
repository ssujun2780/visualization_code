#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){char line[32];int n=0,a[8]={0},total=0;if(!fgets(line,sizeof line,stdin)||sscanf(line,"%d",&n)!=1||n<0||n>8)return 1;
 for(int i=0;i<n;i++){int redundant=0;if(!fgets(line,sizeof line,stdin))return 1;if(sscanf(line,"%d",&redundant)!=1)return 1;if(sscanf(line,"%d",&a[i])!=1)return 1;total+=a[i];}
 printf("%d %d\n",n,total);return 0;}
