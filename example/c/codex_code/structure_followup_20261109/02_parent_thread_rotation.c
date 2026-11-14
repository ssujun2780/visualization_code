#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
#include <stdint.h>

typedef struct N{struct N*parent,*low,*high,*thread;int value;}N;
N*rotate(N*x){N*y=x->high;x->high=y->low;if(y->low)y->low->parent=x;y->parent=x->parent;y->low=x;x->parent=y;return y;}
int sum(N*p){if(!p)return 0;return sum(p->low)+p->value+sum(p->high);}
int main(void){N a[7]={0};for(int i=0;i<7;i++){a[i].value=i+1;a[i].thread=i<6?&a[i+1]:0;}
N*root=&a[3];root->low=&a[1];root->high=&a[5];a[1].parent=root;a[5].parent=root;
a[1].low=&a[0];a[1].high=&a[2];a[0].parent=&a[1];a[2].parent=&a[1];
a[5].low=&a[4];a[5].high=&a[6];a[4].parent=&a[5];a[6].parent=&a[5];
root=rotate(root);int threaded=0;for(N*p=a;p;p=p->thread)threaded+=p->value;
printf("%d %d %d\n",sum(root),threaded,root->value);return 0;}
