#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

int main(void){int a[8]={0},n=0,in[5]={5,1,4,2,3};for(int t=0;t<5;t++){int pos=n;while(pos>0&&a[pos-1]>in[t]){a[pos]=a[pos-1];pos--;}a[pos]=in[t];n++;}
 int out=0;while(n){out=out*10+a[0];for(int j=1;j<n;j++)a[j-1]=a[j];n--;}printf("%d\n",out);return 0;}
