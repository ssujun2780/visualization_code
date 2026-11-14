#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int x,y;} Point;typedef struct{Point p[2];int tag;} Shape;
int main(void){Shape s={.p={{.y=2,.x=1},{.x=3,.y=4}},.tag=7};int total=0;for(int i=0;i<3;i++){Shape copy=s;copy.p[i%2].x+=i;s=copy;total+=s.p[0].x+s.p[1].x;}printf("%d %d %d\n",s.p[0].x,s.p[1].x,total);return 0;}
