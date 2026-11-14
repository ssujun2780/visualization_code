#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){int i=0,x=0,total=0;for(int pass=0;pass<3;pass++){x=(i++,i*3);total+=(x+=2,x);i++;i--;}printf("%d %d %d\n",i,x,total);return 0;}
