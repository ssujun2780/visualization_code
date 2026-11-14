#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){int h[12],n=0,input[7]={9,2,7,1,3,8,4};for(int k=0;k<7;k++){int i=n++;h[i]=input[k];while(i>0){int p=(i-1)/2;if(h[p]<=h[i])break;int t=h[p];h[p]=h[i];h[i]=t;i=p;}}
printf("heap %d %d\n",n,h[0]);int sum=0;while(n){sum+=h[0];h[0]=h[--n];int i=0;while(2*i+1<n){int j=2*i+1;if(j+1<n&&h[j+1]<h[j])j++;if(h[i]<=h[j])break;int t=h[i];h[i]=h[j];h[j]=t;i=j;}}
printf("sum %d\n",sum);return 0;}
