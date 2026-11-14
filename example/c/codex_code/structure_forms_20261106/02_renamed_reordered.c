#include <stdio.h>
#include <stdlib.h>
typedef struct K {struct K *q;int m;struct K *z;} K;
int sum(K*p){if(!p)return 0;int a=sum(p->z);int b=sum(p->q);return p->m+a+b;}
int main(void){K a[5]={{.m=1},{.m=2},{.m=3},{.m=4},{.m=5}};
a[0].z=&a[1];a[0].q=&a[2];a[1].z=&a[3];a[1].q=&a[4];K*w=&a[0];

printf("%d\n",sum(w));return 0;}