#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
typedef struct{int value,c[2];}N;N pool[20]={{-1,{1,2}},{12,{3,4}},{-6,{5,6}},{7,{7,8}},{20,{9,10}},{2,{11,12}},{15,{13,14}},{-3,{15,16}},{10,{-1,-1}},{-8,{-1,-1}},{5,{-1,-1}},{18,{-1,-1}},{0,{-1,-1}},{13,{-1,-1}},{-5,{-1,-1}},{8,{-1,-1}},{21,{-1,-1}}};int scan(int k){if(k<0)return 0;return pool[k].value+scan(pool[k].c[0])+scan(pool[k].c[1]);}int main(void){printf("%d\n",scan(0));return 0;}
