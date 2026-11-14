#include <stdio.h>
#include <stdarg.h>
int sum(int n,...){va_list ap;va_start(ap,n);int total=0;for(int i=0;i<n;i++)total+=va_arg(ap,int);va_end(ap);return total;}
int main(void){printf("%d\n",sum(3,4,5,6));return 0;}
