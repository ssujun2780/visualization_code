#include <stdio.h>
typedef struct Node {int key;struct Node *left,*right;} Node;
Node nodes[7];
Node *insert(Node *root,Node *item){
    if(!root)return item;
    if(item->key<root->key)root->left=insert(root->left,item);
    else root->right=insert(root->right,item);
    return root;
}
void visit(Node *p){
    if(!p)return;
    visit(p->left);printf("%d ",p->key);visit(p->right);
}
int main(void){
    int keys[7]={8,3,12,1,6,10,14};Node *root=NULL;
    for(int i=0;i<7;i++){nodes[i].key=keys[i];root=insert(root,&nodes[i]);}
    visit(root);puts("");return 0;
}
