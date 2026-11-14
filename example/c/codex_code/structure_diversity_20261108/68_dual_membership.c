#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct N{int v;struct N*a,*b;}N;
int forward(N*p){int n=0;while(p){n=n*10+p->v;p=p->a;}return n;}int backward(N*p){int n=0;while(p){n=n*10+p->v;p=p->b;}return n;}
int main(void){N a[4]={0};for(int i=0;i<4;i++){a[i].v=i+1;if(i<3)a[i].a=&a[i+1];if(i>0)a[i].b=&a[i-1];}N*h1=a,*h2=&a[3];printf("%d %d\n",forward(h1),backward(h2));return 0;}
