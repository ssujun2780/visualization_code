#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int get(const int*a,int index){return a[index];}void put(int*a,int index,int value){a[index]=value;}
int main(void){int a[20]={17,3,11,3,9,0,21,8,8,4,19,2,16,1,7,13,6,12,5,10},n=20;
for(int i=1;i<n;i++){int key=get(a,i);int j=i-1;while(j>=0&&get(a,j)>key){int temporary=get(a,j);put(a,j+1,temporary);j--;}put(a,j+1,key);}
for(int i=0;i<n;i++)printf("%d%s",a[i],i+1==n?"\n":" ");return 0;}
