#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct B{int keys[3],used;struct B*child[4];}B;
int sum(B*p){int s=0;for(int i=0;i<p->used;i++)s+=p->keys[i];for(int i=0;i<=p->used;i++)if(p->child[i])s+=sum(p->child[i]);return s;}
int main(void){B pool[8]={0};pool[0].used=3;pool[0].keys[0]=15;pool[0].keys[1]=30;pool[0].keys[2]=45;int slots[4]={3,6,2,7},v[4]={5,20,35,50};for(int i=0;i<4;i++){B*p=pool+slots[i];p->used=1;p->keys[0]=v[i];pool[0].child[i]=p;}B*root=pool;printf("%d\n",sum(root));return 0;}
