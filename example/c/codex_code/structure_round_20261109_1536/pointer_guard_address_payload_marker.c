#include <stdio.h>
typedef struct N {int value;struct N*next;}N;
N pool[3]={{5,0},{7,0},{11,0}};
int main(void){
 pool[1].next=pool+2;pool[2].next=pool;
 N*root=pool+1;int count=0,special=0,sum=0;
 for(N*p=root;p;p=p->next){
  count++;
  if(p==&pool[0])special++;
  sum+=p->value;
 }
 printf("%d %d %d\n",count,special,sum);
 return 0;
}
