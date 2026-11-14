#include <stdio.h>
int keys[8]={0,20,10,30,5},aa[8]={0,2,0,0,0},bb[8]={0,3,0,0,0};
unsigned tag[8]={0,0x10,0x21,0x31,0x41};
int walk(int p){return p?1+walk(aa[p])+walk(bb[p]):0;}
int find(int p,int k){while(p){if(keys[p]==k)return 1;p=k<keys[p]?aa[p]:bb[p];}return 0;}
int black(int p){if(!p)return 1;int a=black(aa[p]),b=black(bb[p]);if(a<0||b<0||a!=b)return -1;
if((tag[p]&1)&&((tag[aa[p]]&1)||(tag[bb[p]]&1)))return -1;return a+!(tag[p]&1);}
void show(const char*s,int root){printf("%s %d %d %d\n",s,walk(root),find(root,10)+find(root,30),!(tag[root]&1)&&black(root)>0);}
int main(void){int seed=1;show("P0",seed);aa[2]=4;show("P1",seed);tag[2]&=~1U;show("P2",seed);tag[3]&=~1U;show("P3",seed);return 0;}
