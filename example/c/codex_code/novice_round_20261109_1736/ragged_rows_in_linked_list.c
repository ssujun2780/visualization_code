#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct Row{int*data,n;struct Row*next;}Row;
int main(void){int a[2]={1,2},b[4]={3,4,5,6},c[1]={7};Row rows[3]={{a,2,0},{b,4,0},{c,1,0}};rows[0].next=rows+1;rows[1].next=rows+2;Row*head=rows;int sum=0,n=0;for(Row*p=head;p;p=p->next){for(int j=0;j<p->n;j++)sum+=p->data[j];n++;}printf("%d %d\n",n,sum);return 0;}
