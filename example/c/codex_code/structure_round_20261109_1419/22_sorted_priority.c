#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){int h[12],n=0,input[7]={9,2,7,1,3,8,4};for(int k=0;k<7;k++){h[n++]=input[k];for(int i=1;i<n;i++){int x=h[i],j=i;while(j>0&&h[j-1]>x){h[j]=h[j-1];j--;}h[j]=x;}}
printf("priority %d %d\n",n,h[0]);int sum=0;while(n){sum+=h[0];for(int j=1;j<n;j++)h[j-1]=h[j];n--;}printf("sum %d\n",sum);return 0;}
