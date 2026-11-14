#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int cell[9],count;int priority[9];}H;
int main(void){H h={0};int items[5]={8,3,7,1,5};for(int k=0;k<5;k++){int i=++h.count;h.cell[i]=items[k];h.priority[k]=k;}
int bad=0;for(int i=2;i<=h.count;i++)if(h.cell[i]<h.cell[i/2])bad++;printf("%d %d %d\n",h.count,h.cell[1],bad);return 0;}
