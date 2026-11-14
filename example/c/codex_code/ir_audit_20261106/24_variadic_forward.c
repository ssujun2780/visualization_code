#include <stdio.h>
#include <stdarg.h>
int emit(const char *format,...){
 va_list ap;va_start(ap,format);
 int n=vprintf(format,ap);
 va_end(ap);return n;
}
int main(void){int n=emit("%d %.1f\n",7,2.5);printf("len=%d\n",n);return 0;}
