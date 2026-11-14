#include <stdio.h>
typedef struct T{int key;struct T*left,*right;}T;
/* Deliberately defined but never called: not runtime evidence. */
int unused_find(T*p,int x) {
    while(p){if(x==p->key)return 1;p=x<p->key?p->left:p->right;}
    return 0;
}
int fold(T*p) {return p?p->key+fold(p->left)+fold(p->right):0;}
int main(void) {
    T nodes[3]={{10,0,0},{5,0,0},{15,0,0}};
    nodes[0].left=nodes+1;nodes[0].right=nodes+2;
    T*root=nodes;
    int sorted[4]={1,2,3,4},s=0;
    for(int i=0;i<4;i++)s+=sorted[i];
    printf("P0 %d\n",fold(root)+s);
    return 0;
}
