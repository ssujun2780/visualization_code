#include <stdio.h>
typedef struct N {int major,minor,cache;struct N*up,*l,*r;}N;
int compare(int a,int b,N*p) {
    if(a<p->major)return -1;
    if(a>p->major)return 1;
    return (b>p->minor)-(b<p->minor);
}
int find(N*p,int a,int b) {
    while(p){int c=compare(a,b,p);if(c==0)return 1;p=c<0?p->l:p->r;}
    return 0;
}
int walk(N*p) {return p?1+walk(p->l)+walk(p->r):0;}
int main(void) {
    N v[4]={{2,5,80,0,0,0},{1,9,-4,0,0,0},{2,8,50,0,0,0},{2,1,999,0,0,0}};
    v[0].l=v+1;v[0].r=v+2;v[1].r=v+3;
    v[1].up=v;v[2].up=v;v[3].up=v+1;
    N*root=v;
    printf("P0 %d\n",walk(root)+find(root,2,1)+find(root,2,8));
    v[3].cache=-999;
    printf("P1 %d\n",walk(root)+find(root,2,1));
    v[3].minor=6;
    printf("P2 %d\n",walk(root)+find(root,2,6));
    return 0;
}
