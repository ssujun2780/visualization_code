#include <stdio.h>
#include <math.h>
int main(void){
 double a=NAN,b=INFINITY;
 int first=a==a;
 int second=a!=a;
 int third=(a<0.0)||(b>100.0);
 _Bool truth=a;
 printf("%d %d %d %d\n",first,second,third,truth);
 return 0;
}
