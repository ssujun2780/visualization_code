#include <stdio.h>

typedef struct N{int key,red;struct N*l,*r,*p;}N;N store[128],nil;N*root=&nil;int used=0;
void left(N*x){N*y=x->r;x->r=y->l;if(y->l!=&nil)y->l->p=x;y->p=x->p;if(x->p==&nil)root=y;else if(x==x->p->l)x->p->l=y;else x->p->r=y;y->l=x;x->p=y;}
void right(N*x){N*y=x->l;x->l=y->r;if(y->r!=&nil)y->r->p=x;y->p=x->p;if(x->p==&nil)root=y;else if(x==x->p->r)x->p->r=y;else x->p->l=y;y->r=x;x->p=y;}
void insert(int key){N*z=store+used++;*z=(N){key,1,&nil,&nil,&nil};N*y=&nil,*x=root;while(x!=&nil){y=x;x=key<x->key?x->l:x->r;}z->p=y;if(y==&nil)root=z;else if(key<y->key)y->l=z;else y->r=z;
while(z->p->red){if(z->p==z->p->p->l){N*u=z->p->p->r;if(u->red){z->p->red=0;u->red=0;z->p->p->red=1;z=z->p->p;}else{if(z==z->p->r){z=z->p;left(z);}z->p->red=0;z->p->p->red=1;right(z->p->p);}}else{N*u=z->p->p->l;if(u->red){z->p->red=0;u->red=0;z->p->p->red=1;z=z->p->p;}else{if(z==z->p->l){z=z->p;right(z);}z->p->red=0;z->p->p->red=1;left(z->p->p);}}}root->red=0;}
int verify(N*p,int lo,int hi){if(p==&nil)return 1;if(p->key<=lo||p->key>=hi)return -1000;if(p->red&&(p->l->red||p->r->red))return -1000;int a=verify(p->l,lo,p->key),b=verify(p->r,p->key,hi);if(a<0||b<0||a!=b)return -1000;return a+!p->red;}
int sum(N*p){return p==&nil?0:p->key+sum(p->l)+sum(p->r);}
int main(void){nil=(N){0,0,&nil,&nil,&nil};int input[17]={10,1,2,3,0,14,5,11,8,9,4,13,6,16,12,7,15};for(int i=0;i<17;i++)insert(input[i]);printf("%d %d %d\n",used,sum(root),verify(root,-1,1000)>0&&!root->red);return 0;}
