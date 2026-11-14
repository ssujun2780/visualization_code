#include <stdio.h>
int main(void){int a[4]={-1,0,0,0};int sum=0;for(int i=0;i<4;i++){int p=i;while(p!=-1){sum++;p=a[p];}}printf("%d\n",sum);for(int i=0;i<4;i++)a[i]=(i%2+1)*10;sum=0;for(int i=0;i<4;i++)sum+=a[i];printf("%d\n",sum);return 0;}
