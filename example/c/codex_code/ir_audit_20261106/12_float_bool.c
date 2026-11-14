#include <stdio.h>
#include <math.h>
int main(void){
 double x=-0.5,y=2.25;
 _Bool b=x;int z=(int)x;float f=(float)(x+y*2);
 double whole=0;double part=modf(y,&whole);
 int exponent=0;double mantissa=frexp(8.0,&exponent);
 printf("%d %d %.2f %.2f %.0f %.2f %d\n",b,z,(double)f,part,whole,mantissa,exponent);
 return 0;
}
