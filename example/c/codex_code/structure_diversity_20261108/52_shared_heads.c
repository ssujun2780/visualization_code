#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct N{int v;struct N*next;}N;
int digits(N*p){int n=0;while(p){n=n*10+p->v;p=p->next;}return n;}
int main(void){N a={1,0},b={2,0},c={3,0},d={9,0};a.next=&b;b.next=&c;d.next=&b;N*one=&a,*two=&d;printf("%d %d\n",digits(one),digits(two));return 0;}

