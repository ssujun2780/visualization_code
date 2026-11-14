#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
typedef struct{int value,c[2];}N;N pool[6]={{-1,{1,2}},{12,{-1,-1}},{-6,{-1,-1}}};int scan(int k){if(k<0)return 0;return pool[k].value+scan(pool[k].c[0])+scan(pool[k].c[1]);}int main(void){printf("%d\n",scan(0));return 0;}
