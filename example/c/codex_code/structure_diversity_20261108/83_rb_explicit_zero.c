#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct N{int key,red;struct N*l,*r,*p;}N;
N nil={0};N*root=0;
void left(N*x){N*y=x->r;x->r=y->l;if(y->l!=&nil)y->l->p=x;y->p=x->p;if(x->p==&nil)root=y;else if(x==x->p->l)x->p->l=y;else x->p->r=y;y->l=x;x->p=y;}
void right(N*x){N*y=x->l;x->l=y->r;if(y->r!=&nil)y->r->p=x;y->p=x->p;if(x->p==&nil)root=y;else if(x==x->p->r)x->p->r=y;else x->p->l=y;y->r=x;x->p=y;}
void insert(N*z){N*y=&nil,*x=root;while(x!=&nil){y=x;x=z->key<x->key?x->l:x->r;}z->p=y;if(y==&nil)root=z;else if(z->key<y->key)y->l=z;else y->r=z;z->l=z->r=&nil;z->red=1;
 while(z->p->red){if(z->p==z->p->p->l){N*u=z->p->p->r;if(u->red){z->p->red=0;u->red=0;z->p->p->red=1;z=z->p->p;}else{if(z==z->p->r){z=z->p;left(z);}z->p->red=0;z->p->p->red=1;right(z->p->p);}}
 else{N*u=z->p->p->l;if(u->red){z->p->red=0;u->red=0;z->p->p->red=1;z=z->p->p;}else{if(z==z->p->l){z=z->p;right(z);}z->p->red=0;z->p->p->red=1;left(z->p->p);}}}root->red=0;}
int check(N*p,int lo,int hi){if(p==&nil)return 1;if(p->key<=lo||p->key>=hi)return -1;if(p->red&&(p->l->red||p->r->red))return -1;int l=check(p->l,lo,p->key),r=check(p->r,p->key,hi);return l<0||r<0||l!=r?-1:l+!p->red;}
int sum(N*p){if(p==&nil)return 0;return p->key+sum(p->l)+sum(p->r);}
int main(void){nil.l=nil.r=nil.p=&nil;root=&nil;N a[7]={0};for(int i=0;i<7;i++){a[i].key=i+1;insert(&a[i]);if(root->red||check(root,-1,100)<0)return 2;}printf("%d\n",sum(root));return 0;}

