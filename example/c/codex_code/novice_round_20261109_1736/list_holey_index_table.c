#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){int table[7][4]={{0}};int slots[4]={5,1,6,3};for(int i=0;i<7;i++)table[i][2]=-1;for(int i=0;i<4;i++){int k=slots[i];table[k][0]=10+i;table[k][1]=1;table[k][2]=i<3?slots[i+1]:-1;table[k][3]=77;}int head=5,sum=0,n=0;for(int k=head;k!=-1;k=table[k][2]){sum+=table[k][0];n++;}printf("%d %d\n",n,sum);return 0;}
