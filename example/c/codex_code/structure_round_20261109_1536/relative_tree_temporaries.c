#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
int val[6]={-1,12,-6,7,20,2},a[6]={1,2,3,0,0,0},b[6]={2,3,0,0,0,0};int scan(int k){int s=val[k];int ca=a[k],cb=b[k];if(ca){int j=k+ca;s+=scan(j);}if(cb){int j=k+cb;s+=scan(j);}return s;}int main(void){printf("%d\n",scan(0));return 0;}
