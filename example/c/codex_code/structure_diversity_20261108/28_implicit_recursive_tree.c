#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

int visit(const int*a,int i,int count){if(i>=count)return 0;int l=2*i+1;int r=l+1;return a[i]+visit(a,l,count)+visit(a,r,count);}
int main(void){int a[7]={1,2,3,4,5,6,7};printf("%d\n",visit(a,0,7));return 0;}
