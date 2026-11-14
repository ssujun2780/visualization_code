#include <stdio.h>

int a[8],lo=0,hi=8;
void left(int x){a[lo++]=x;}void right(int x){a[--hi]=x;}
int takeleft(void){return a[--lo];}int takeright(void){return a[hi++];}
int main(void){left(11);left(22);right(31);right(32);int x=takeleft(),y=takeright();printf("S0 %d %d %d %d\n",x,y,lo,hi);return 0;}
