#include <stdio.h>
#include <stdlib.h>
typedef struct N {int v;struct N*l,*r;} N;
int sum(N*p){if(!p)return 0;int a=sum(p->l);int b=sum(p->r);return p->v+a+b;}
int main(void){N*parts[5]={0};for(int i=0;i<5;i++){parts[i]=calloc(1,sizeof *parts[i]);if(!parts[i]){for(int j=0;j<i;j++)free(parts[j]);return 1;}parts[i]->v=i+1;}
parts[0]->l=parts[1];parts[0]->r=parts[2];parts[1]->l=parts[3];parts[1]->r=parts[4];N*root=parts[0];printf("%d\n",sum(root));for(int i=0;i<5;i++)free(parts[i]);return 0;}