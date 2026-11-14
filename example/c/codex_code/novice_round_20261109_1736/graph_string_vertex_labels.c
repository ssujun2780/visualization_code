#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{char from[8],to[8];int w;}E;
int main(void){char names[3][8]={"oak","elm","ash"};E e[3]={{"oak","elm",2},{"elm","ash",3},{"ash","oak",4}};int matrix[3][3]={0};for(int k=0;k<3;k++){int u=-1,v=-1;for(int i=0;i<3;i++){if(!strcmp(names[i],e[k].from))u=i;if(!strcmp(names[i],e[k].to))v=i;}if(u>=0&&v>=0)matrix[u][v]=e[k].w;}printf("%d %d %d\n",matrix[0][1],matrix[1][2],matrix[2][0]);return 0;}
