#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
typedef struct{int value,l,r;}N;N pool[13]={{-1,1,2},{12,3,4},{-6,5,6},{7,7,8},{20,9,-1},{2,-1,-1},{15,-1,-1},{-3,-1,-1},{10,-1,-1},{-8,-1,-1}};int scan(int k){if(k<0)return 0;return pool[k].value+scan(pool[k].l)+scan(pool[k].r);}int main(void){printf("%d\n",scan(0));return 0;}
