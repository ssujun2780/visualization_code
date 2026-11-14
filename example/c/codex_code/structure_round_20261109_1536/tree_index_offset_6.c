#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
int val[6]={-1,12,-6,7,20,2},a[6]={1,2,3,0,0,0},b[6]={2,3,0,0,0,0};int scan(int k){int s=val[k];if(a[k])s+=scan(k+a[k]);if(b[k])s+=scan(k+b[k]);return s;}int main(void){printf("%d\n",scan(0));return 0;}
