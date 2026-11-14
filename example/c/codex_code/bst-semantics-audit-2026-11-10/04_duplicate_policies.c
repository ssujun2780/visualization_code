#include <stdio.h>
typedef struct N {int value;struct N*lo,*hi;}N;
void put_right(N*p,N*n) {
    while(1) {
        if(n->value<p->value) { if(p->lo)p=p->lo; else {p->lo=n;return;} }
        else { if(p->hi)p=p->hi; else {p->hi=n;return;} }
    }
}
void put_left(N*p,N*n) {
    while(1) {
        if(n->value<=p->value) { if(p->lo)p=p->lo; else {p->lo=n;return;} }
        else { if(p->hi)p=p->hi; else {p->hi=n;return;} }
    }
}
int walk(N*p) {return p?1+walk(p->lo)+walk(p->hi):0;}
int main(void) {
    N a[4]={{8,0,0},{4,0,0},{12,0,0},{4,0,0}};
    N b[4]={{8,0,0},{4,0,0},{12,0,0},{4,0,0}};
    N *right_root=a,*left_root=b;
    for(int i=1;i<4;i++){put_right(right_root,a+i);put_left(left_root,b+i);}
    printf("R0 %d\n",walk(right_root));
    printf("L0 %d\n",walk(left_root));
    return 0;
}
