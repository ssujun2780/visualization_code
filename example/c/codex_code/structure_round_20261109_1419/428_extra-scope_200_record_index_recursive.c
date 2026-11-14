#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int value,left,right;}N;N a[5]={{4,1,2},{2,3,4},{6,-1,-1},{1,-1,-1},{3,-1,-1}};
int visit(int k){if(k<0)return 0;return a[k].value+visit(a[k].left)+visit(a[k].right);}
int main(void){{printf("%d\n",visit(0));return 0;}}
