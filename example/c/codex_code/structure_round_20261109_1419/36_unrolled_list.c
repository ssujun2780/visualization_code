#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct B{int data[3],used;struct B*next;}B;
int main(void){B blocks[3]={{{1,2,3},3,0},{{4,5,0},2,0},{{6,0,0},1,0}};blocks[0].next=blocks+1;blocks[1].next=blocks+2;B*head=blocks;int sum=0;
for(B*p=head;p;p=p->next)for(int i=0;i<p->used;i++)sum+=p->data[i];printf("%d\n",sum);return 0;}
