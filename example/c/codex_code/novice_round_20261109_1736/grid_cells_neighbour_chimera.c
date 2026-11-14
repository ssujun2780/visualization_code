#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct Cell{int v;struct Cell*east,*south,*next;}Cell;
int main(void){Cell a[2][3]={0};for(int r=0;r<2;r++)for(int c=0;c<3;c++){a[r][c].v=r*3+c+1;a[r][c].east=c<2?&a[r][c+1]:0;a[r][c].south=r<1?&a[r+1][c]:0;a[r][c].next=c<2?&a[r][c+1]:(r<1?&a[r+1][0]:0);}Cell*head=&a[0][0];int sum=0;for(Cell*p=head;p;p=p->next)sum+=p->v;int border=0;for(Cell*p=head;p;p=p->east)border+=p->v;printf("%d %d\n",sum,border);return 0;}
