#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
#include <stdint.h>

typedef struct N{int value;struct N*l,*r;}N;typedef struct{int count;long long sum;}Stats;
Stats scan(const N*p){if(!p)return(Stats){0,0};Stats a=scan(p->l),b=scan(p->r);return(Stats){a.count+b.count+1,a.sum+b.sum+p->value};}
int main(void){N a={2,0,0},b={8,0,0},root={5,&a,&b};Stats result=scan(&root);printf("%d %lld\n",result.count,result.sum);return 0;}
