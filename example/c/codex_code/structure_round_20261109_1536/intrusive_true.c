#include <stdio.h>
#include <stdlib.h>
#include <stddef.h>
#include <string.h>

typedef struct L {struct L*next;struct L*prev;} L;
typedef struct {int key;L link;int extra;} N;
int main(void){
 L head;head.next=&head;head.prev=&head;
 N items[4]={{.key=11},{.key=7},{.key=3},{.key=5}};
 for(int i=3;i>=0;i--){
  items[i].link.next=head.next;
  items[i].link.prev=&head;head.next->prev=&items[i].link;
  head.next=&items[i].link;
 }
 int sum=0,count=0;
 for(L*p=head.next;p!=&head;p=p->next){N*n=(N*)((char*)p - offsetof(N,link));sum+=n->key;count++;}
 printf("%d %d\n",sum,count);
 return 0;
}
