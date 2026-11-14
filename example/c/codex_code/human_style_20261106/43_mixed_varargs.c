#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <stdarg.h>
double combine(int tag,...){va_list a,b;va_start(a,tag);va_copy(b,a);int x=va_arg(a,int);double y=va_arg(a,double);unsigned long long z=va_arg(a,unsigned long long);int xx=va_arg(b,int);double yy=va_arg(b,double);unsigned long long zz=va_arg(b,unsigned long long);va_end(a);va_end(b);return x+y+(double)z+xx+yy+(double)zz;}
int main(void){double x=combine(0,-3,2.5,9ULL);printf("%.1f\n",x);return 0;}
