#include <stdio.h>
typedef struct Q { int data; struct Q *x,*y; } Q;
int cmp(int a,int b) { return (a<b)-(a>b); }
int walk(Q*p) { return p?1+walk(p->x)+walk(p->y):0; }
int find(Q*p,int key) {
    while(p) { int r=cmp(key,p->data); if(!r)return 1; p=r<0?p->x:p->y; }
    return 0;
}
int main(void) {
    Q v[4]={{10,0,0},{15,0,0},{5,0,0},{12,0,0}};
    v[0].x=v+1; v[0].y=v+2; v[1].y=v+3;
    Q *root=v;
    printf("P0 %d\n",walk(root)+find(root,12)+find(root,5));
    v[3].data=8;
    printf("P1 %d\n",walk(root)+find(root,8));
    return 0;
}
