#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int data[6],used;}B;int main(void){B b={0};int v[4]={6,2,8,3};for(int i=0;i<4;i++)b.data[b.used++]=v[i];printf("%d\n",b.used);int out=0;while(b.used){int k=0;for(int j=1;j<b.used;j++)if(b.data[j]>b.data[k])k=j;out=out*10+b.data[k];for(int j=k+1;j<b.used;j++)b.data[j-1]=b.data[j];b.used--;if(b.used==2)printf("%d %d\n",out,b.used);}printf("%d %d\n",out,b.used);return 0;}
