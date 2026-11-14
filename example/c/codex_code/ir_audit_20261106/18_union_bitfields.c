#include <stdio.h>
#include <string.h>
typedef struct {unsigned a:3;unsigned b:5;} Flags;
typedef union {Flags flags;unsigned char bytes[sizeof(Flags)];} Data;
int main(void){
 Data x={0};x.flags.a=3;x.flags.b=17;
 Data y;memcpy(&y,&x,sizeof x);
 unsigned old=y.flags.a++;y.flags.b^=3;
 printf("%u %u %u %u\n",old,y.flags.a,y.flags.b,x.flags.b);
 return 0;
}
