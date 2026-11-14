#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

int main(void){int table[7],keys[4]={1,8,15,2};for(int i=0;i<7;i++)table[i]=-1;
 for(int i=0;i<4;i++){int at=keys[i]%7;while(table[at]!=-1)at=(at+1)%7;table[at]=keys[i];}
 int sum=0;for(int i=0;i<4;i++){int at=keys[i]%7;while(table[at]!=keys[i])at=(at+1)%7;sum+=table[at];}printf("%d\n",sum);return 0;}
