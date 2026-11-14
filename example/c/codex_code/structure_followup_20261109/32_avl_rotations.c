#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct N{int key,height;struct N*l,*r;}N;
int h(N*p){return p?p->height:0;}int max(int a,int b){return a>b?a:b;}
void update(N*p){p->height=1+max(h(p->l),h(p->r));}
N*right(N*x){N*y=x->l;x->l=y->r;y->r=x;update(x);update(y);return y;}
N*left(N*x){N*y=x->r;x->r=y->l;y->l=x;update(x);update(y);return y;}
N*insert(N*p,int k){if(!p){N*n=malloc(sizeof *n);if(!n)exit(1);*n=(N){k,1,0,0};return n;}if(k<p->key)p->l=insert(p->l,k);else p->r=insert(p->r,k);update(p);int b=h(p->l)-h(p->r);if(b>1){if(k>p->l->key)p->l=left(p->l);return right(p);}if(b< -1){if(k<p->r->key)p->r=right(p->r);return left(p);}return p;}
int sum(N*p){return p?p->key+sum(p->l)+sum(p->r):0;}
void clear(N*p){if(p){clear(p->l);clear(p->r);free(p);}}
int main(void){int keys[6]={30,20,10,25,28,27};N*root=0;for(int i=0;i<6;i++)root=insert(root,keys[i]);printf("%d %d %d\n",root->key,root->height,sum(root));clear(root);return 0;}
