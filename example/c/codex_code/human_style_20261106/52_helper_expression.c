#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int read_at(const int*a,int i){int copy=a[i];return copy;}
int main(void){int a[5]={3,8,-2,7,4},b[5]={5,1,6,-3,2},index[5]={4,2,0,3,1},total=0;
for(int pass=0;pass<3;pass++)for(int i=0;i<5;i++){int answer=read_at(a,i)+read_at(b,index[i])*2-read_at(a,4-i);total+=answer;}printf("%d\n",total);return 0;}
