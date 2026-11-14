#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct L{void*data;struct L*next;}L;
void each(L*p,void(*f)(void*,void*),void*ctx){for(;p;p=p->next)f(p->data,ctx);}void sum(void*p,void*c){*(int*)c+=*(int*)p;}
int main(void){int a[4]={1,2,3,4},result=0;L links[4]={0};for(int i=0;i<4;i++){links[i].data=&a[i];if(i<3)links[i].next=&links[i+1];}
 each(links,sum,&result);printf("%d\n",result);return 0;}
