#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int*slot(int x){static int a[3]={0};static int next=0;a[next]=x;int*p=&a[next];next=(next+1)%3;return p;}
int main(void){int*p[6];for(int i=0;i<6;i++)p[i]=slot(i+1);int total=0;for(int i=0;i<6;i++)total+=*p[i];printf("%d %d %d %d\n",*p[0],*p[1],*p[2],total);return 0;}
