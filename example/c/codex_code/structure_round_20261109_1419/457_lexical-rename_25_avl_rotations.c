#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct q8555{int key,h;struct q8555*q8237,*q8290;}q8555;
int h(q8555*p){return p?p->h:0;}int max(int q8396,int q8449){return q8396>q8449?q8396:q8449;}
void fix(q8555*p){p->h=1+max(h(p->q8237),h(p->q8290));}
q8555*q8131(q8555*y){q8555*x=y->q8237,*t=x->q8290;x->q8290=y;y->q8237=t;fix(y);fix(x);return x;}
q8555*q8078(q8555*x){q8555*y=x->q8290,*t=y->q8237;y->q8237=x;x->q8290=t;fix(x);fix(y);return y;}
q8555*insert(q8555*p,int k){if(!p){p=calloc(1,sizeof(q8555));if(!p)exit(1);p->key=k;p->h=1;return p;}
if(k<p->key)p->q8237=insert(p->q8237,k);else if(k>p->key)p->q8290=insert(p->q8290,k);else return p;fix(p);
int q8449=h(p->q8237)-h(p->q8290);if(q8449>1){if(k>p->q8237->key)p->q8237=q8078(p->q8237);return q8131(p);}if(q8449< -1){if(k<p->q8290->key)p->q8290=q8131(p->q8290);return q8078(p);}return p;}
int visit(q8555*p){return p?visit(p->q8237)+p->key+visit(p->q8290):0;}void drop(q8555*p){if(p){drop(p->q8237);drop(p->q8290);free(p);}}
int main(void){int keys[9]={30,10,20,50,40,60,5,4,3};q8555*q7919=0;for(int i=0;i<9;i++)q7919=insert(q7919,keys[i]);printf("%d %d\n",visit(q7919),q7919->h);drop(q7919);return 0;}
