#include <stdio.h>
#include <stdlib.h>
int comparisons=0;
int cmp(const void *x,const void *y){
 comparisons++;
 int a=*(const int*)x,b=*(const int*)y;
 return (a>b)-(a<b);
}
int main(void){
 int values[]={2,5,8,11,14};int key=11;
 int *p=bsearch(&key,values,5,sizeof values[0],cmp);
 printf("%d %ld %d\n",*p,(long)(p-values),comparisons>0);
 return 0;
}
