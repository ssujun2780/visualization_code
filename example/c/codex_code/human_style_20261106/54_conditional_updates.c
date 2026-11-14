#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int hits=0;int positive(int x){hits++;return x>0;}
int main(void){int a[5]={0,2,-3,4,0},total=0;for(int pass=0;pass<2;pass++)for(int i=0;i<5;i++){int x=a[i];int ok=x!=0&&positive(x);int result=ok?(x+=2):(x-=1);total+=result;}printf("%d %d\n",total,hits);return 0;}
