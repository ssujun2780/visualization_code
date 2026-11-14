#include <stdio.h>
int main(void){
 int a[]={2,4,6},b[]={10,20,30};int *p=a,*q=b;
 *p++ += *q++;
 int old=(*p)++;
 *(++p)=*(++q)-old;
 printf("%d %d %d %d %ld %ld\n",a[0],a[1],a[2],old,(long)(p-a),(long)(q-b));
 return 0;
}
