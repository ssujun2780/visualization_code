#include <stdio.h>
#include <stdlib.h>

typedef struct{int x,next;}N;N*a;int head=0;
int walk(void){int s=0;for(int i=head;i!=-1;i=a[i].next)s+=a[i].x;return s;}
int main(void){a=malloc(2*sizeof *a);if(!a)return 0;a[0]=(N){1,1};a[1]=(N){2,-1};printf("%d ",walk());N*p=realloc(a,4*sizeof *a);if(!p){free(a);return 0;}a=p;a[1].next=2;a[2]=(N){3,3};a[3]=(N){4,-1};printf("%d ",walk());free(a);return 0;}