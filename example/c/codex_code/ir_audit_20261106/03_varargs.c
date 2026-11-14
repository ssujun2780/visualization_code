#include <stdio.h>
#include <stdarg.h>
double weighted(int count,...){
 va_list ap;va_start(ap,count);
 double total=0;
 for(int i=0;i<count;i++){
  int weight=va_arg(ap,int);
  double value=va_arg(ap,double);
  total+=weight*value; // @write:total
 }
 va_end(ap);return total;
}
int main(void){double result=weighted(3,2,1.5,3,2.0,-1,0.5);printf("%.1f\n",result);return 0;}
