#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct N{struct N*next;int v;}N;
int main(void){N header={0,99},a={0,0},b={0,7};header.next=&a;a.next=&b;b.next=&header;
int sum=0,count=0;for(N*p=header.next;p!=&header;p=p->next){sum+=p->v;count++;}
printf("%d %d\n",sum,count);return 0;}
