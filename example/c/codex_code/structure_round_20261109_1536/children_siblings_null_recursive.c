#include <stdio.h>
#include <stdlib.h>
#include <stddef.h>

typedef struct N { struct N *child,*sibling; int payload; } N;
N nil;
int walk(N*p){
 if(p==NULL)return 0;
 int total=p->payload;
 for(N*q=p->child;q!=NULL;q=q->sibling){
  total+=walk(q);
 }
 return total;
}
int main(void){
 N pool[5];
 for(int i=0;i<5;i++){
  pool[i].child=pool[i].sibling=NULL;
  pool[i].payload=i+1;
 }
 pool[0].child=&pool[1];
 pool[1].sibling=&pool[2];
 pool[1].child=&pool[3];
 pool[3].sibling=&pool[4];
 N*root=&pool[0];
 int sum=0;
 sum=walk(root);
 printf("%d\n",sum);
 return 0;
}
