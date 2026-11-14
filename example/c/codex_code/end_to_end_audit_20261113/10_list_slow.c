#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <assert.h>
typedef struct Cell { int value; struct Cell *next; } Cell;
int main(void) {
    int n=0;
    if(scanf("%d",&n)!=1 || n<1 || n>64) return 1;
    Cell *head=NULL;
    for(int i=0;i<n;i++) {
        Cell *fresh=calloc(1,sizeof(*fresh));
        if(!fresh) return 1;
        fresh->value=i+1;
        if(!head) head=fresh;
        else { Cell *p=head; while(p->next) p=p->next; p->next=fresh; }
    }
    Cell *back=NULL,*p=head;
    while(p) { Cell *next=p->next; p->next=back; back=p; p=next; }
    head=back;
    int sum=0;
    for(p=head;p;p=p->next) {
        sum+=p->value; // @audit sum
    }
    printf("%d\n",sum);
    while(head) { Cell *next=head->next; free(head); head=next; }
    return 0;
}
