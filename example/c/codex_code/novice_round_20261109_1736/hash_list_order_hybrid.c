#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct N{int key,v;struct N*bucket,*order;}N;
int main(void){N a[5]={0};N*heads[3]={0};N*first=0,*last=0;for(int i=0;i<5;i++){a[i].key=i*3+1;a[i].v=i+1;int k=a[i].key%3;a[i].bucket=heads[k];heads[k]=a+i;if(last)last->order=a+i;else first=a+i;last=a+i;}
int x=0,y=0;for(N*p=heads[1];p;p=p->bucket)x=x*10+p->v;for(N*p=first;p;p=p->order)y=y*10+p->v;printf("%d %d\n",x,y);return 0;}
