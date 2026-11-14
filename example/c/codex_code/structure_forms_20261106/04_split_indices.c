#include <stdio.h>
#include <stdlib.h>
int sum(int*v,int*l,int*r,int i){if(i<0)return 0;int x=sum(v,l,r,l[i]);int y=sum(v,l,r,r[i]);return v[i]+x+y;}
int main(void){int v[5]={1,2,3,4,5},l[5]={1,3,-1,-1,-1},r[5]={2,4,-1,-1,-1};printf("%d\n",sum(v,l,r,0));return 0;}