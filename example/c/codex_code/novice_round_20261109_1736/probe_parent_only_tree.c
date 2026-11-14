#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int up,value,cache;}R;int main(void){R a[6]={{-1,1,99},{3,2,99},{0,3,99},{0,4,99},{3,5,99},{2,6,99}};int sum=0;for(int start=0;start<6;start++){int p=start,d=0;while(p!=-1){d++;p=a[p].up;}sum+=d;}printf("%d\n",sum);return 0;}
