#include <stdio.h>
typedef int (*Operation)(int);
int inc(int n){return n+1;}int square(int n){return n*n;}
Operation choose(int mode){return mode?square:inc;}
int main(void){Operation one=choose(0);int a=one(4);Operation two=choose(1);int b=two(a);printf("%d %d\n",a,b);return 0;}
