#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <stdarg.h>
int sumtwice(int n,...){va_list a,b;va_start(a,n);va_copy(b,a);int x=0,y=0;for(int i=0;i<n;i++)x+=va_arg(a,int);for(int i=0;i<n;i++)y+=va_arg(b,int);va_end(a);va_end(b);return x+y;}
int main(void){int a=sumtwice(4,1,2,3,4),b=sumtwice(3,5,6,7);printf("%d %d\n",a,b);return 0;}
