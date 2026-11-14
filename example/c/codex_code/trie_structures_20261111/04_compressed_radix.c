#include <stdio.h>
#include <string.h>
typedef struct Node Node;typedef struct{const char*label;Node*to;}Edge;struct Node{Edge child[2];int accept;};Node arena[5];
int get(const char*s){Node*p=&arena[0];while(*s){int hit=0;for(int i=0;i<2;i++){const char*z=p->child[i].label;if(z){int n=strlen(z);if(strncmp(s,z,n)==0){s+=n;p=p->child[i].to;hit=1;break;}}}if(!hit)return 0;}return p->accept;}
int main(void){arena[0].child[0].label="ca";arena[0].child[0].to=&arena[1];arena[0].child[1].label="dog";arena[0].child[1].to=&arena[4];
arena[1].child[0].label="r";arena[1].child[0].to=&arena[2];arena[1].child[1].label="t";arena[1].child[1].to=&arena[3];
arena[2].accept=1;arena[3].accept=1;arena[4].accept=1;int a=get("car"),b=get("ca"),c=get("dog"),d=get("cab");printf("Q %d %d %d %d\n",a,b,c,d);return 0;}
