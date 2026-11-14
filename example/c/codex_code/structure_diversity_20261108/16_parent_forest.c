#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

int root(int*p,int x){if(p[x]!=x)p[x]=root(p,p[x]);return p[x];}
int main(void){int p[5]={0,0,1,3,3};int a=root(p,2),b=root(p,4);p[b]=a;int c=root(p,4);printf("%d %d\n",a,c);return 0;}
