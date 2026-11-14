#include <stdio.h>
#define PART 3+4
#define DOUBLE(x) ((x)+(x))
#define TEXT(x) #x
int main(void){
 int a=2*PART;
 int b=DOUBLE(5-1);
 int c=(PART)*2;
 printf("%d %d %d %s\n",a,b,c,TEXT(PART));return 0;
}
