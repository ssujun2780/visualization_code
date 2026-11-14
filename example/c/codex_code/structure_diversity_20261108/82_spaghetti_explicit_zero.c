#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

int data[12]={0},copy[12]={0},size=0;
int main(void){int x=1,out=0;again:if(x>3)goto taking;for(int i=0;i<size;i++)copy[i]=data[i];copy[size]=x;
 for(int i=0;i<=size;i++)data[i]=copy[i];size=size+1;x=x+1;goto again;
 taking:if(size==0)goto done;int value=data[size-1];out=out*10+value;size=size-1;for(int i=0;i<size;i++){copy[i]=data[i];data[i]=copy[i];}goto taking;
 done:printf("%d\n",out);return 0;}

