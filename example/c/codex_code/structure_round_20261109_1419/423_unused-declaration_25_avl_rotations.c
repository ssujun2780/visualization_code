typedef struct UnusedDeclaration { long double noise; int unrelated[17]; } UnusedDeclaration;
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct N{int key,h;struct N*l,*r;}N;
int h(N*p){return p?p->h:0;}int max(int a,int b){return a>b?a:b;}
void fix(N*p){p->h=1+max(h(p->l),h(p->r));}
N*right(N*y){N*x=y->l,*t=x->r;x->r=y;y->l=t;fix(y);fix(x);return x;}
N*left(N*x){N*y=x->r,*t=y->l;y->l=x;x->r=t;fix(x);fix(y);return y;}
N*insert(N*p,int k){if(!p){p=calloc(1,sizeof(N));if(!p)exit(1);p->key=k;p->h=1;return p;}
if(k<p->key)p->l=insert(p->l,k);else if(k>p->key)p->r=insert(p->r,k);else return p;fix(p);
int b=h(p->l)-h(p->r);if(b>1){if(k>p->l->key)p->l=left(p->l);return right(p);}if(b< -1){if(k<p->r->key)p->r=right(p->r);return left(p);}return p;}
int visit(N*p){return p?visit(p->l)+p->key+visit(p->r):0;}void drop(N*p){if(p){drop(p->l);drop(p->r);free(p);}}
int main(void){int keys[9]={30,10,20,50,40,60,5,4,3};N*root=0;for(int i=0;i<9;i++)root=insert(root,keys[i]);printf("%d %d\n",visit(root),root->h);drop(root);return 0;}
