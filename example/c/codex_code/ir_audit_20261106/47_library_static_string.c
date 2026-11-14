#include <stdio.h>
#include <string.h>
int main(void){
 const char *message=strerror(0);
 int nonempty=message[0]!=0;
 printf("%d\n",nonempty);return 0;
}
