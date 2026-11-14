#include <stdio.h>
#include <stdlib.h>

typedef struct Item Item;typedef struct Bucket Bucket;struct Item{int value;Item*next;Bucket*owner;};struct Bucket{Item*first;Bucket*next;int count;};int main(void){Bucket b[2]={0};Item a[5]={0};b[0].next=b+1;b[0].first=a;b[1].first=a+3;b[0].count=3;b[1].count=2;for(int i=0;i<5;i++){a[i].value=i+1;a[i].owner=b+(i>=3);if(i!=2&&i!=4)a[i].next=a+i+1;}Bucket*root=b;int sum=0,groups=0;for(Bucket*p=root;p;p=p->next){groups++;for(Item*q=p->first;q;q=q->next)sum+=q->value;}printf("%d %d\n",groups,sum);return 0;}
