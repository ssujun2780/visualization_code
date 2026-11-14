#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int data[9],used;}Bag;
int main(void){Bag b={0};int v[5]={8,1,9,3,7};for(int i=0;i<5;i++){b.data[b.used++]=v[i];for(int x=b.used-1;x>0&&b.data[x]<b.data[x-1];x--){int t=b.data[x];b.data[x]=b.data[x-1];b.data[x-1]=t;}}
int out=0;while(b.used){int k=0;out=out*10+b.data[k];for(int j=k+1;j<b.used;j++)b.data[j-1]=b.data[j];b.used--;}printf("%d\n",out);return 0;}
