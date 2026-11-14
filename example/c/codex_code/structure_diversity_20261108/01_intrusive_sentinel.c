#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct Link{struct Link *before,*after;} Link;
typedef struct Item{int payload;Link link;} Item;
static void insert(Link*at,Link*x){x->before=at->before;x->after=at;at->before->after=x;at->before=x;}
int main(void){Link anchor={&anchor,&anchor};Item items[4]={0};
 for(int i=0;i<4;i++){items[i].payload=i+1;insert(&anchor,&items[i].link);}
 int sum=0;for(Link*p=anchor.after;p!=&anchor;p=p->after){Item*x=(Item*)((char*)p - offsetof(Item,link));sum+=x->payload;}
 printf("%d\n",sum);return 0;}
