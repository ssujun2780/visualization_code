#include <stdio.h>
#include <stdlib.h>
#include <errno.h>
#include <limits.h>
int main(void){
 errno=0;
 char *end;
 long value=strtol("999999999999999999999999999999",&end,10);
 int range=errno==ERANGE;
 printf("%d %d %d\n",value==LONG_MAX,range,*end==0);
 return 0;
}
