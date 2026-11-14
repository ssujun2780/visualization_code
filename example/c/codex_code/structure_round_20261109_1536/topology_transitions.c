#include <stdio.h>
#include <stdlib.h>
#include <stddef.h>

typedef struct N { struct N*a,*b;int id; } N;
int count(N*root){N*work[20];int used=0,seen[4]={0},sum=0;work[used++]=root;
 while(used){N*p=work[--used];if(!p||seen[p->id])continue;seen[p->id]=1;sum++;
  if(p->a)work[used++]=p->a;if(p->b)work[used++]=p->b;
 }return sum;
}
int main(void){
 N pool[4]={{0,0,0},{0,0,1},{0,0,2},{0,0,3}};
 N*root=pool;pool[0].a=pool+1;pool[0].b=pool+2;pool[1].a=pool+3;
 printf("%d\n",count(root));
 pool[2].a=pool+3;printf("%d\n",count(root));
 pool[3].a=pool;printf("%d\n",count(root));
 pool[2].a=NULL;pool[3].a=NULL;printf("%d\n",count(root));
 return 0;
}
