#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct{int value,next,used;}N;
int main(void){N p[5]={0};for(int i=0;i<5;i++)p[i].next=i==4?-1:i+1;int freehead=0,head=-1;
 for(int v=1;v<=3;v++){int i=freehead;freehead=p[i].next;p[i].used=1;p[i].value=v;p[i].next=head;head=i;}
 int drop=head;head=p[head].next;p[drop].used=0;p[drop].next=freehead;freehead=drop;
 int i=freehead;freehead=p[i].next;p[i].used=1;p[i].value=5;p[i].next=head;head=i;
 int out=0;for(int j=head;j!=-1;j=p[j].next)out+=p[j].value;
 int old=head;head=p[head].next;p[old].used=0;p[old].next=freehead;freehead=old;
 printf("%d\n",out-(p[head].value));return 0;}
