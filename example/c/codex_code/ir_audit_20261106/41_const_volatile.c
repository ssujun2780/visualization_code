#include <stdio.h>
int main(void){
 const int fixed=4;
 int a=fixed*2+1;
 volatile int state=0;
 int no=state||state;
 state=3;
 int yes=state&&state;
 printf("%d %d %d\n",a,no,yes);return 0;
}
