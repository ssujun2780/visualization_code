#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct N{int v,h;struct N*l,*r;}N;
int height(N*p){return p?p->h:0;}void fix(N*p){int l=height(p->l),r=height(p->r);p->h=1+(l>r?l:r);}
N*right(N*p){N*q=p->l;p->l=q->r;q->r=p;fix(p);fix(q);return q;}N*left(N*p){N*q=p->r;p->r=q->l;q->l=p;fix(p);fix(q);return q;}
N*insert(N*p,N*x){if(!p)return x;if(x->v<p->v)p->l=insert(p->l,x);else p->r=insert(p->r,x);fix(p);
 int b=height(p->l)-height(p->r);if(b>1){if(x->v>p->l->v)p->l=left(p->l);return right(p);}if(b < -1){if(x->v<p->r->v)p->r=right(p->r);return left(p);}return p;}
void visit(N*p,int*out){if(!p)return;visit(p->l,out);*out=*out*10+p->v;visit(p->r,out);}
int main(void){N n[7]={0},*root=0;for(int i=0;i<7;i++){n[i].v=i+1;n[i].h=1;root=insert(root,&n[i]);}int out=0;visit(root,&out);printf("%d\n",out);return 0;}
