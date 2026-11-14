#include <stdio.h>
int main(void){
 unsigned char a[1]={250};unsigned char *p=a;
 int x=(*p)++;
 int y=p[0]++;
 int z=++*p;
 *p+=1;
 printf("%d %d %d %u\n",x,y,z,(unsigned)*p);return 0;
}
