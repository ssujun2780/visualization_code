#include <stdio.h>
#include <stdlib.h>

typedef struct N{int value;struct N*next;}N;
int sum(N*p){int s=0;while(p){s+=p->value;p=p->next;}return s;}
int main(void){N*pool=malloc(2*sizeof(N));if(!pool)return 1;pool[0]=(N){2,pool+1};pool[1]=(N){3,0};printf("small %d\n",sum(pool));
N*fresh=realloc(pool,5*sizeof(N));if(!fresh){free(pool);return 1;}pool=fresh;for(int i=0;i<5;i++){pool[i].value=i+1;pool[i].next=i<4?pool+i+1:0;}
printf("grown %d\n",sum(pool));free(pool);pool=0;printf("gone %d\n",pool==0);return 0;}
