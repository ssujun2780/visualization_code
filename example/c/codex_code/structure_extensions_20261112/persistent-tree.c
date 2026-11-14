#include <stdio.h>
typedef struct N{int value;struct N*l,*r;}N;N pool[16];int used;N*old,*fresh;
N*build(int l,int r){N*p=pool+used++;if(r-l==1){p->value=l+1;return p;}int m=(l+r)/2;p->l=build(l,m);p->r=build(m,r);p->value=p->l->value+p->r->value;return p;}
N*change(N*p,int l,int r,int x,int v){N*q=pool+used++;*q=*p;if(r-l==1){q->value=v;return q;}int m=(l+r)/2;if(x<m)q->l=change(p->l,l,m,x,v);else q->r=change(p->r,m,r,x,v);q->value=q->l->value+q->r->value;return q;}
int visit(N*p){return p?1+visit(p->l)+visit(p->r):0;}
int main(void){old=build(0,4);fresh=change(old,0,4,1,8);visit(old);visit(fresh);printf("%d %d ",old->value,fresh->value);return 0;}