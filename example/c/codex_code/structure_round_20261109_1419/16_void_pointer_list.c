#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int value;void*link;}Cell;
int main(void){Cell a={2,0},b={5,0},c={8,0};a.link=&b;b.link=&c;void*head=&a;int s=0;
for(void*p=head;p;p=((Cell*)p)->link)s+=((Cell*)p)->value;printf("%d\n",s);return 0;}
