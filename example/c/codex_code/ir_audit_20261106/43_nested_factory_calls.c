#include <stdio.h>
typedef int (*Operation)(int);
int inc(int x){return x+1;}int square(int x){return x*x;}
Operation choose(int n){return n?square:inc;}
int main(void){int result=choose(choose(0)(0))(3);printf("%d\n",result);return 0;}
