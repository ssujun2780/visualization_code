#include <stdio.h>
#include <stdlib.h>
typedef struct N{int v;struct N*n;}N;
int scan(N*h){int s=0;for(N*p=h;p;p=p->n)s+=p->v;return s;}
int main(void){N*a=malloc(sizeof*a),*b=malloc(sizeof*b),*c=malloc(sizeof*c);if(!a||!b||!c){free(a);free(b);free(c);return 1;}
*a=(N){9,c};*b=(N){9,0};*c=(N){9,b};N*head=a;printf("S0 %d\n",scan(head));
N**slot=&head;slot=&(*slot)->n;N*dead=*slot;*slot=dead->n;free(dead);c=0;printf("S1 %d\n",scan(head));
head=0;free(a);free(b);printf("S2 %d\n",scan(head));return 0;}
