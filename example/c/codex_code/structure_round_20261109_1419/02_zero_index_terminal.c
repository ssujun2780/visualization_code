#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int a[6]={0,4,2,6,1,3},b[6]={0,2,4,0,0,0},c[6]={0,3,5,0,0,0};
int walk(int k){if(k==0)return 0;return a[k]+walk(b[k])+walk(c[k]);}
int main(void){printf("%d\n",walk(1));return 0;}
