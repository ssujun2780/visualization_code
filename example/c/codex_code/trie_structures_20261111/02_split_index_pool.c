#include <stdio.h>
int links[9][2],done[9],used=1;
void put(const char*s){int p=0;while(*s){int c=*s++-'a';if(links[p][c]<0)links[p][c]=used++;p=links[p][c];}done[p]=1;}
int get(const char*s){int p=0;while(*s){int c=*s++-'a';if(links[p][c]<0)return 0;p=links[p][c];}return done[p];}
int main(void){for(int i=0;i<9;i++)for(int j=0;j<2;j++)links[i][j]=-1;put("a");put("ab");put("ba");int a=get("ab"),b=get("b"),c=get("ba"),d=get("bb");printf("Q %d %d %d %d\n",a,b,c,d);return 0;}
