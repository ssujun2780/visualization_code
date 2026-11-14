#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct{int left,right,parent;}Tree;
int main(void){Tree nodes[3]={{1,2,0},{2,1,0},{3,2,1}};int sum=0;for(int i=0;i<3;i++)sum+=nodes[i].left+nodes[i].right+nodes[i].parent;printf("%d\n",sum);return 0;}
