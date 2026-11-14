#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){int s=0;{struct Node{int value;struct Node*next;};struct Node x={2,0},y={3,0};x.next=&y;for(struct Node*p=&x;p;p=p->next)s+=p->value;printf("list %d\n",s);}
{struct Node{int value;struct Node*left,*right;};struct Node x={5,0,0},y={7,0,0},z={11,0,0};x.left=&y;x.right=&z;s=x.value+x.left->value+x.right->value;printf("tree %d\n",s);}return 0;}
