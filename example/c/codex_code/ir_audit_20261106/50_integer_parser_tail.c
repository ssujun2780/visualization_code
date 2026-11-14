#include <stdio.h>
#include <stdlib.h>
int main(void){
 char text[]="18446744073709551615:end";char *end;
 unsigned long long n=strtoull(text,&end,10);
 printf("%llu %c %ld\n",n,*end,(long)(end-text));
 return 0;
}
