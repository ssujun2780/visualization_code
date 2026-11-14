#include <stdio.h>
#include <stdlib.h>

typedef struct R{int z;struct R*x,*y,*w;}R;int f(R*p){int n=p->z;for(R*q=p->x;q;q=q->y)n+=f(q);return n;}int main(void){R a[5]={0};for(int i=0;i<5;i++)a[i].z=i+2;a[0].x=a+3;a[3].y=a+1;a[1].y=a+4;a[3].x=a+2;a[3].w=a;a[1].w=a;a[4].w=a;a[2].w=a+3;R*root=a;printf("%d\n",f(root));return 0;}
