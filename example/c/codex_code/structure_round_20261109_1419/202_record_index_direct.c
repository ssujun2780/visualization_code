#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int value,left,right;}N;N a[5]={{4,1,2},{2,3,4},{6,-1,-1},{1,-1,-1},{3,-1,-1}};
int main(void){int s=0;for(int k=0;k<5;k++){s+=a[k].value;if(a[k].left>=0)s+=a[a[k].left].value;if(a[k].right>=0)s+=a[a[k].right].value;}printf("%d\n",s);return 0;}
