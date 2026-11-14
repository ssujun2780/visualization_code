#include <stdio.h>
typedef struct Node {struct Node *child[2];int accept,debug;} Node;
Node arena[9];int used=1;
void put(const char*s){Node*p=&arena[0];while(*s){int c=*s++-'a';if(!p->child[c])p->child[c]=&arena[used++];p=p->child[c];p->debug=77;}p->accept=1;}
int get(const char*s){Node*p=&arena[0];while(*s){int c=*s++-'a';if(!p->child[c])return 0;p=p->child[c];}return p->accept;}
int main(void){put("a");put("ab");put("ba");int a=get("ab"),b=get("b"),c=get("ba"),d=get("bb");printf("Q %d %d %d %d\n",a,b,c,d);return 0;}
