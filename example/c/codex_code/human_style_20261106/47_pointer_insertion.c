#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void){int a[20]={17,3,11,3,9,0,21,8,8,4,19,2,16,1,7,13,6,12,5,10},n=20;
for(int i=1;i<n;i++){int key=*(a+i);int*position=a+i;while(position>a&&*(position-1)>key){*position=*(position-1);position--;}*position=key;}
for(int i=0;i<n;i++)printf("%d%s",a[i],i+1==n?"\n":" ");return 0;}
