#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct N{int v;struct N*next;}N;
int main(void){N a[4]={{1,0},{2,0},{3,0},{4,0}};for(int i=0;i<4;i++)a[i].next=&a[(i+1)%4];N*h=&a[2],*p=h;int sum=0;
 do{sum+=p->v;p=p->next;}while(p!=h);printf("%d\n",sum);return 0;}

