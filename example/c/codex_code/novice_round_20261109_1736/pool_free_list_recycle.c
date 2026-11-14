#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int value,next,used;}N;
int main(void){N pool[6];for(int i=0;i<6;i++)pool[i]=(N){0,i<5?i+1:-1,0};int avail=0,head=-1;for(int value=1;value<=3;value++){int k=avail;avail=pool[k].next;pool[k]=(N){value,head,1};head=k;}int removed=pool[head].next;pool[head].next=pool[removed].next;pool[removed].used=0;pool[removed].next=avail;avail=removed;int old=pool[removed].value;int k=avail;avail=pool[k].next;pool[k]=(N){9,head,1};head=k;int sum=0,n=0;for(int p=head;p>=0;p=pool[p].next){sum+=pool[p].value;n++;}int freecount=0;for(int p=avail;p>=0;p=pool[p].next)freecount++;printf("%d %d %d %d\n",n,sum,freecount,old);return 0;}
