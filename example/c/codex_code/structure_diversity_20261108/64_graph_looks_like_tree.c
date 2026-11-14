#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct V{int value,count;struct V*out[3];}V;
int main(void){V v[3]={{1,0,{0}},{2,0,{0}},{3,0,{0}}};v[0].out[v[0].count++]=&v[1];v[0].out[v[0].count++]=&v[2];int sum=v[0].value;
 for(int i=0;i<v[0].count;i++)sum+=v[0].out[i]->value;printf("%d\n",sum);return 0;}
