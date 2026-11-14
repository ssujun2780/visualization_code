#include <stdio.h>
typedef struct N{int value,count;struct N*children[4];}N;
int visit(N*p){int s=p->value;for(int i=0;i<p->count;i++)s+=visit(p->children[i]);return s;}
int main(void){N nodes[5]={0};for(int i=0;i<5;i++)nodes[i].value=i+1;nodes[0].count=4;for(int i=0;i<4;i++)nodes[0].children[i]=nodes+i+1;N*root=nodes;for(int k=0;k<2;k++)printf("%d %d\n",k,visit(root));return 0;}
