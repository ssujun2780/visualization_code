#include <stdio.h>
typedef struct {int value;} Box;
int main(void){
 Box a={3},b={8};Box *p=&a,*q=&b;
 int choose=0;
 (choose?p:q)->value+=4;
 int old=((choose?*p:*q).value);
 choose=1;
 (choose?p:q)->value=old-2;
 printf("%d %d %d\n",a.value,b.value,old);return 0;
}
