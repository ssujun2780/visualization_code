#include <stdio.h>
int main(void){
 int n=2;
 int bytes=(int)sizeof(int[++n]);
 printf("%d %d\n",n,bytes);return 0;
}
