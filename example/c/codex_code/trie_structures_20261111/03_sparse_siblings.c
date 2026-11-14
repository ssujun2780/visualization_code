#include <stdio.h>
typedef struct Node {char token;int accept;struct Node*down,*side;} Node;Node arena[9];int used=1;
void put(const char*s){Node*p=&arena[0];while(*s){Node*q=p->down;while(q&&q->token!=*s)q=q->side;
if(!q){q=&arena[used++];q->token=*s;q->side=p->down;p->down=q;}p=q;s++;}p->accept=1;}
int get(const char*s){Node*p=&arena[0];while(*s){Node*q=p->down;while(q&&q->token!=*s)q=q->side;if(!q)return 0;p=q;s++;}return p->accept;}
int main(void){put("a");put("ab");put("ba");int a=get("ab"),b=get("b"),c=get("ba"),d=get("bb");printf("Q %d %d %d %d\n",a,b,c,d);return 0;}
