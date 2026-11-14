#include <stdio.h>
#include <stdlib.h>
typedef struct Cell{int value;struct Cell*next;} Cell;
static void dispose(Cell*p){while(p){Cell*q=p->next;free(p);p=q;}}
static int append(Cell**root,int x){Cell*q=malloc(sizeof*q);if(!q)return 0;q->value=x;q->next=NULL;if(!*root)*root=q;else{Cell*p=*root;while(p->next)p=p->next;p->next=q;}return 1;}
int main(void){int n;Cell*root=NULL;if(scanf("%d",&n)!=1||n<1||n>20)return 1;
 for(int i=0;i<n;i++){int x;if(scanf("%d",&x)!=1||!append(&root,x)){dispose(root);return 1;}}
 Cell*previous=NULL;Cell*cursor=root;
 while(cursor){Cell*next=cursor->next;cursor->next=previous;previous=cursor;cursor=next;}root=previous;
 int total=0;
 for(Cell*p=root;p;p=p->next){
  total+=p->value; /* @trace:sum */
 }
 printf("%d\n",total);dispose(root);root=NULL;return 0;}
