#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int q8025,q8078,q8131;}q8502;q8502 q7919[5]={{4,1,2},{2,3,4},{6,-1,-1},{1,-1,-1},{3,-1,-1}};
int visit(int k){if(k<0)return 0;return q7919[k].q8025+visit(q7919[k].q8078)+visit(q7919[k].q8131);}
int main(void){printf("%d\n",visit(0));return 0;}
