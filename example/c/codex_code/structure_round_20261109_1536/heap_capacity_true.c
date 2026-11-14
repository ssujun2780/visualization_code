#include <stdio.h>
#include <stdlib.h>
#include <stddef.h>

typedef struct {int data[12];int used;} H;
void push(H*h,int x){int i=h->used++;while(i){int p=(i-1)/2;if(h->data[p]<=x)break;h->data[i]=h->data[p];i=p;}h->data[i]=x;}
int pop(H*h){int result=h->data[0],x=h->data[--h->used],i=0;
 while(2*i+1<h->used){int c=2*i+1;if(c+1<h->used&&h->data[c+1]<h->data[c])c++;
  if(x<=h->data[c])break;h->data[i]=h->data[c];i=c;
 }if(h->used)h->data[i]=x;return result;}
int main(void){H h={{0},0};int values[6]={9,2,7,1,5,3};
 for(int i=0;i<6;i++)push(&h,values[i]);
 printf("%d\n",h.used);
 int sum=0;while(h.used)sum+=pop(&h);
 printf("%d\n",sum);return 0;
}
