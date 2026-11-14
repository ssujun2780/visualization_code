#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct N{int v;struct N*next;}N;
int main(void){{N tail={4,0},a={1,&tail},b={2,&tail};N*roots[2]={&a,&b};int s=0;
for(int i=0;i<2;i++)for(N*p=roots[i];p;p=p->next)s+=p->v;
printf("%d\n",s);return 0;}}
