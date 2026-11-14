#include <stdio.h>
typedef struct N{int key,h,cache;struct N*l,*r;}N;N a[3]={{2,1,1,0,0},{1,1,1,0,0},{3,1,1,0,0}};N*root=a;
int height(N*p){if(!p)return 0;int x=height(p->l),y=height(p->r);p->h=(x>y?x:y)+1;return p->h;}
int main(void){a[0].l=a+1;a[0].r=a+2;printf("%d %d ",height(root),a[0].cache);return 0;}