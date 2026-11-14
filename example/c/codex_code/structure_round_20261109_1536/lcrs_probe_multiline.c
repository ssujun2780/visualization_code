#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
typedef struct N{
struct N*first,*next;
int value;
}
N;
int scan(N*p){
int s=p->value;
for(N*q=p->first;
q;
q=q->next)s+=scan(q);
return s;
}
int main(void){
N pool[3]={
0}
;
int v[3]={
-1,12,-6}
;
for(int i=0;
i<3;
i++){
pool[i].value=v[i];
if(2*i+1<3)pool[i].first=&pool[2*i+1];
if(i%2==1&&i+1<3)pool[i].next=&pool[i+1];
}
N*root=pool;
printf("%d\n",scan(root));
return 0;
}

