#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){int label[7],size[7]={0};for(int i=0;i<7;i++)label[i]=i;int pairs[4][2]={{0,2},{2,4},{1,3},{4,3}};for(int k=0;k<4;k++){int a=label[pairs[k][0]],b=label[pairs[k][1]];for(int j=0;j<7;j++)if(label[j]==b)label[j]=a;}for(int i=0;i<7;i++)size[label[i]]++;printf("%d %d %d\n",label[3],size[0],size[5]);return 0;}
