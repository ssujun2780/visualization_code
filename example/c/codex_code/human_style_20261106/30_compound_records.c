#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int x,y;} Point;
int measure(Point p){Point copy=p;return copy.x*copy.x+copy.y*copy.y;}
int main(void){int total=0;for(int i=0;i<4;i++){total+=measure((Point){i,1});total+=measure((Point){i,1});}printf("%d\n",total);return 0;}
