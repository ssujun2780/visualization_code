#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){int a[5]={5,1,4,2,3},comparisons=0,swaps=0;
 for(int pass=0;pass<4;pass++){int copy[5];for(int k=0;k<5;k++)copy[k]=a[k];for(int k=0;k<5;k++)a[k]=copy[k];
  for(int j=0;j<4;j++){comparisons++;if(a[j]>a[j+1]){int temporary=a[j];a[j]=a[j+1];a[j+1]=temporary;swaps++;}}}
 for(int i=0;i<5;i++)printf("%d ",a[i]);printf("| %d %d\n",comparisons,swaps);return 0;}
