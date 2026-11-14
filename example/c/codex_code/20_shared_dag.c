#include <stdio.h>
#include <stdlib.h>
typedef struct N{int id,value;struct N*left,*right;} N;
static int visit(const N*p,unsigned*seen){if(!p||(*seen&(1u<<p->id)))return 0;*seen|=1u<<p->id;return p->value+visit(p->left,seen)+visit(p->right,seen);}
int main(void){N*p=calloc(4,sizeof*p);if(!p)return 1;for(int i=0;i<4;i++){p[i].id=i;if(scanf("%d",&p[i].value)!=1||p[i].value<-100||p[i].value>100){free(p);return 1;}}
 p[0].left=&p[1];p[0].right=&p[2];p[1].right=&p[3];p[2].left=&p[3];
 unsigned seen=0;int sum=visit(p,&seen);printf("%d %u\n",sum,seen);free(p);return 0;}
