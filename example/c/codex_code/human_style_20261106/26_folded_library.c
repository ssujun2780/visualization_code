#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int ticks=0;int touch(void){ticks++;return 3;}
int main(void){int total=0;for(int i=0;i<4;i++){int n=(int)strlen("abc")+abs(-4);int same=strcmp("aa","aa");total+=n+same+touch();}printf("%d %d\n",total,ticks);return 0;}
