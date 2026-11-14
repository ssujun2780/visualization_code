#include <stdio.h>
#include <stdlib.h>
int main(void){
 div_t result=div(-23,7);
 printf("%d %d\n",result.quot,result.rem);return 0;
}
