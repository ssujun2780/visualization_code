#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){setvbuf(stdin,NULL,_IONBF,0);int count=0,total=0,c;while((c=getchar())!='\n'){if(c==EOF)break;ungetc(c,stdin);int again=getchar();count++;total+=again-'0';}printf("%d %d\n",count,total);return 0;}
