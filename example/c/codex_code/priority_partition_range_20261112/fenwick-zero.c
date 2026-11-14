#include <stdio.h>
int input[4]={2,3,4,5},store[4];
void push(int k,int d){for(;k<4;k=k|(k+1))store[k]+=d;}
int sum(int k){int z=0;while(k>=0){z+=store[k];k=(k&(k+1))-1;}return z;}
int main(void){for(int i=0;i<4;i++)push(i,input[i]);printf("%d ",sum(2));push(1,4);printf("%d ",sum(3));return 0;}