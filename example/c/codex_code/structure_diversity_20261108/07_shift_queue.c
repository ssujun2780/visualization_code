#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct{int a[8];int used;}Q;
int main(void){Q q={0};for(int i=1;i<=3;i++){q.a[q.used]=i;q.used=q.used+1;}int out=0;
 while(q.used){int v=q.a[0];for(int j=1;j<q.used;j++)q.a[j-1]=q.a[j];q.used--;out=out*10+v;}
 printf("%d\n",out);return 0;}
