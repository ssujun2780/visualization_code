#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int data[9],used;}Bag;
int main(void){Bag b={0};int v[5]={8,1,9,3,7};for(int i=0;i<5;i++){b.data[b.used++]=v[i];}
int out=0;while(b.used){int k=0;for(int j=1;j<b.used;j++)if(b.data[j]>b.data[k])k=j;out=out*10+b.data[k];for(int j=k+1;j<b.used;j++)b.data[j-1]=b.data[j];b.used--;}printf("%d\n",out);return 0;}
