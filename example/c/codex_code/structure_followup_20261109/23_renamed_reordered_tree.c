#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
#include <stdint.h>

typedef struct N{int x69;struct N*x58,*x41,*x17,*x33;}N;
N*rotate(N*x){N*y=x->x41;x->x41=y->x33;if(y->x33)y->x33->x17=x;y->x17=x->x17;y->x33=x;x->x17=y;return y;}
int sum(N*p){if(!p)return 0;return sum(p->x33)+p->x69+sum(p->x41);}
int main(void){N a[7]={0};for(int i=0;i<7;i++){a[i].x69=i+1;a[i].x58=i<6?&a[i+1]:0;}
N*root=&a[3];root->x33=&a[1];root->x41=&a[5];a[1].x17=root;a[5].x17=root;
a[1].x33=&a[0];a[1].x41=&a[2];a[0].x17=&a[1];a[2].x17=&a[1];
a[5].x33=&a[4];a[5].x41=&a[6];a[4].x17=&a[5];a[6].x17=&a[5];
root=rotate(root);int threaded=0;for(N*p=a;p;p=p->x58)threaded+=p->x69;
printf("%d %d %d\n",sum(root),threaded,root->x69);return 0;}
