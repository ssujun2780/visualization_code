#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct B{int a[3],n;struct B*next;}B;
int main(void){B b[3]={0};b[0].next=&b[1];b[1].next=&b[2];B*p=b;
 for(int x=1;x<=8;x++){if(p->n==3)p=p->next;p->a[p->n++]=x;}
 int sum=0;for(p=b;p;p=p->next)for(int i=0;i<p->n;i++)sum+=p->a[i];printf("%d\n",sum);return 0;}
