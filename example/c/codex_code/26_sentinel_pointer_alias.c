#include <stdio.h>
#include <stdlib.h>
typedef struct Link{struct Link*next;int value;struct Link*prev;} Link;
int main(void){int n;Link sentinel={&sentinel,0,&sentinel};Link*anchor=&sentinel;if(scanf("%d",&n)!=1||n<1||n>20)return 1;
 for(int i=0;i<n;i++){int x;if(scanf("%d",&x)!=1)return 1;Link*q=malloc(sizeof*q);if(!q){while(sentinel.next!=&sentinel){Link*p=sentinel.next;sentinel.next=p->next;free(p);}return 1;}
  q->value=x;q->prev=sentinel.prev;q->next=&sentinel;sentinel.prev->next=q;sentinel.prev=q;
 }
 int forward=0,backward=0;
 for(Link*p=sentinel.next;p!=anchor;p=p->next){forward+=p->value;} /* @trace:forward */
 for(Link*p=sentinel.prev;p!=anchor;p=p->prev){backward+=p->value;} /* @trace:backward */
 printf("%d %d\n",forward,backward);
 while(sentinel.next!=&sentinel){Link*p=sentinel.next;sentinel.next=p->next;p->next->prev=&sentinel;free(p);}return 0;}

