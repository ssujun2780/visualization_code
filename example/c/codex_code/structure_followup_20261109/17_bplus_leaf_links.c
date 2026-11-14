#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
#include <stdint.h>

typedef struct N{int leaf,n,key[3];struct N*child[4],*next;}N;
N*locate(N*p,int x){while(!p->leaf){int k=0;while(k<p->n&&x>=p->key[k])k++;p=p->child[k];}return p;}
int main(void){N a={.leaf=1,.n=2,.key={1,3}},b={.leaf=1,.n=2,.key={5,7}},c={.leaf=1,.n=2,.key={9,11}};N root={.n=2,.key={5,9},.child={&a,&b,&c}};a.next=&b;b.next=&c;N*p=locate(&root,7);int sum=0;for(N*q=&a;q;q=q->next)for(int i=0;i<q->n;i++)sum+=q->key[i];printf("%d %d\n",p->key[1],sum);return 0;}
