#include <stdio.h>
enum { DARK=7, LIGHT=11 };
typedef struct N{int k,t;struct N*a,*b,*p;}N;
N nodes[8],nil;
void turn_a(N**root,N*x){N*y=x->b;x->b=y->a;if(y->a!=&nil)y->a->p=x;y->p=x->p;
if(x->p==&nil)*root=y;else if(x==x->p->a)x->p->a=y;else x->p->b=y;y->a=x;x->p=y;}
void turn_b(N**root,N*x){N*y=x->a;x->a=y->b;if(y->b!=&nil)y->b->p=x;y->p=x->p;
if(x->p==&nil)*root=y;else if(x==x->p->a)x->p->a=y;else x->p->b=y;y->b=x;x->p=y;}
void put(N**root,N*z,int k){z->k=k;z->a=z->b=&nil;z->t=LIGHT;N*p=&nil,*q=*root;
while(q!=&nil){p=q;q=k<q->k?q->a:q->b;}z->p=p;if(p==&nil)*root=z;else if(k<p->k)p->a=z;else p->b=z;
while(z->p->t==LIGHT){N*g=z->p->p;
if(z->p==g->a){N*u=g->b;if(u->t==LIGHT){z->p->t=DARK;u->t=DARK;g->t=LIGHT;z=g;}
else{if(z==z->p->b){z=z->p;turn_a(root,z);}z->p->t=DARK;z->p->p->t=LIGHT;turn_b(root,z->p->p);}}
else{N*u=g->a;if(u->t==LIGHT){z->p->t=DARK;u->t=DARK;g->t=LIGHT;z=g;}
else{if(z==z->p->a){z=z->p;turn_b(root,z);}z->p->t=DARK;z->p->p->t=LIGHT;turn_a(root,z->p->p);}}}
(*root)->t=DARK;}
int walk(N*p){return p==&nil?0:1+walk(p->a)+walk(p->b);}
int find(N*p,int k){while(p!=&nil){if(k==p->k)return 1;p=k<p->k?p->a:p->b;}return 0;}
int black(N*p){if(p==&nil)return 1;int a=black(p->a),b=black(p->b);if(a<0||b<0||a!=b)return -1;
if(p->t==LIGHT&&(p->a->t==LIGHT||p->b->t==LIGHT))return -1;return a+(p->t==DARK);}
void show(const char*tag,N*root){printf("%s %d %d %d\n",tag,walk(root),find(root,10)+find(root,30),root->t==DARK&&black(root)>0);}
int main(void){nil.t=DARK;nil.a=nil.b=nil.p=&nil;N*seed=&nil;
put(&seed,&nodes[0],10);put(&seed,&nodes[1],20);put(&seed,&nodes[2],30);show("P0",seed);
put(&seed,&nodes[3],15);show("P1",seed);
seed->t=LIGHT;show("P2",seed);seed->t=DARK;nodes[3].t=DARK;show("P3",seed);
nodes[3].t=LIGHT;show("P4",seed);return 0;}
