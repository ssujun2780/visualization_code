#include <stdio.h>
int main(void){
 unsigned char data[2]={250,0};unsigned char *p=data;
 int before=(*p)++;
 int after=--p[1];
 printf("%d %u %d %u\n",before,(unsigned)data[0],after,(unsigned)data[1]);
 return 0;
}
