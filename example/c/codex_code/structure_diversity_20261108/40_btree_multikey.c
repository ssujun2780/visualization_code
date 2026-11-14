#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct N{int count,keys[2];struct N*child[3];}N;
int total(N*p){if(!p)return 0;int sum=0;for(int i=0;i<p->count;i++)sum+=p->keys[i];for(int i=0;i<=p->count;i++)sum+=total(p->child[i]);return sum;}
int main(void){N a={2,{1,2},{0}},b={2,{4,5},{0}},c={2,{7,8},{0}},r={2,{3,6},{&a,&b,&c}};printf("%d\n",total(&r));return 0;}
