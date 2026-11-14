#include <stdio.h>
#include <stdlib.h>
typedef struct {int v,l,r;} T;
int sum(T*a,int i){if(i<0)return 0;int x=sum(a,a[i].l);int y=sum(a,a[i].r);return a[i].v+x+y;}
int main(void){T a[5]={{1,1,2},{2,3,4},{3,-1,-1},{4,-1,-1},{5,-1,-1}};printf("%d\n",sum(a,0));return 0;}