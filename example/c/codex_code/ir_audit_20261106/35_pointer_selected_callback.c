#include <stdio.h>
typedef int (*Operation)(int);
int inc(int n){return n+1;}
int square(int n){return n*n;}
Operation choose(int mode){return mode?square:inc;}
int main(void){
 int a=choose(0)(4);
 int b=choose(1)(a);
 printf("%d %d\n",a,b);return 0;
}
