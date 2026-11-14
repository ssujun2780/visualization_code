#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
#include <stdint.h>

typedef struct{int value,next,live,generation;}Slot;
int main(void){Slot a[5];for(int i=0;i<5;i++)a[i]=(Slot){0,i+1<5?i+1:-1,0,0};int freehead=0,head=-1;
for(int v=1;v<=3;v++){int k=freehead;freehead=a[k].next;a[k].value=v;a[k].live=1;a[k].generation++;a[k].next=head;head=k;}
int old=head;head=a[old].next;a[old].live=0;a[old].next=freehead;freehead=old;
int k=freehead;freehead=a[k].next;a[k].value=9;a[k].live=1;a[k].generation++;a[k].next=head;head=k;
int sum=0;for(int p=head;p!=-1;p=a[p].next)sum+=a[p].value;printf("%d %d\n",sum,a[k].generation);return 0;}
