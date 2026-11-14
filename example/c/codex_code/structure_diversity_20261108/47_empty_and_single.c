#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct N{int v;struct N*next;}N;
int main(void){N*empty=0;N only={7,0};N*root=&only;printf("%d\n",empty?0:root->v);return 0;}
