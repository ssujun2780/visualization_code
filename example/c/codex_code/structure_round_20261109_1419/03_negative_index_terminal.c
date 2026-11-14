#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int a[5]={4,2,6,1,3},b[5]={1,3,-1,-1,-1},c[5]={2,4,-1,-1,-1};
int walk(int k){if(k<0)return 0;return a[k]+walk(b[k])+walk(c[k]);}
int main(void){printf("%d\n",walk(0));return 0;}
