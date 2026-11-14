#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <assert.h>
typedef struct Node { int key; struct Node *left,*right,*parent; } Node;
static Node *insert(Node *root,Node *fresh) {
    if(!root) return fresh;
    Node *p=root;
    for(;;) {
        Node **slot=fresh->key<p->key?&p->left:&p->right;
        if(!*slot) { *slot=fresh; fresh->parent=p; return root; }
        p=*slot;
    }
}
static void print(Node *root) {
    if(!root) return;
    print(root->left); printf("%d ",root->key); print(root->right);
}
int main(void) {
    Node pool[9]={0}, *root=NULL;
    int keys[9]={8,3,12,1,5,10,15,4,6};
    for(int i=0;i<9;i++) { pool[i].key=keys[i]; root=insert(root,&pool[i]); }
    print(root); puts("");
    return 0;
}
