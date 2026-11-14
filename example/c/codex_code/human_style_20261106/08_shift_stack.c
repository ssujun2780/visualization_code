#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){int a[8]={0},size=0,moves=0;for(int x=2;x<=8;x+=2){for(int j=size;j>0;j--){a[j]=a[j-1];moves++;}a[0]=x;size++;}
 while(size){int value=a[0];for(int j=1;j<size;j++){a[j-1]=a[j];moves++;}size--;printf("%d ",value);}printf("| %d\n",moves);return 0;}
