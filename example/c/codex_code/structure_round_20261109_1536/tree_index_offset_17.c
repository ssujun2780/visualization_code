#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
int val[17]={-1,12,-6,7,20,2,15,-3,10,-8,5,18,0,13,-5,8,21},a[17]={1,2,3,4,5,6,7,8,0,0,0,0,0,0,0,0,0},b[17]={2,3,4,5,6,7,8,9,0,0,0,0,0,0,0,0,0};int scan(int k){int s=val[k];if(a[k])s+=scan(k+a[k]);if(b[k])s+=scan(k+b[k]);return s;}int main(void){printf("%d\n",scan(0));return 0;}
