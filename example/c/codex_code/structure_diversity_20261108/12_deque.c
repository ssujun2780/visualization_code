#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct{int a[8],head,n;}D;
void front(D*d,int x){d->head=(d->head+7)%8;d->a[d->head]=x;d->n++;}
void back(D*d,int x){d->a[(d->head+d->n)%8]=x;d->n++;}
int first(D*d){int x=d->a[d->head];d->head=(d->head+1)%8;d->n--;return x;}
int last(D*d){d->n--;return d->a[(d->head+d->n)%8];}
int main(void){D d={0};front(&d,1);back(&d,2);front(&d,3);int a=last(&d),b=first(&d),c=first(&d);printf("%d%d%d\n",a,b,c);return 0;}
