#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct R{int length,leftLength;const char*text;struct R*l,*r;}R;
char at(R*p,int k){if(p->text)return p->text[k];return k<p->leftLength?at(p->l,k):at(p->r,k-p->leftLength);}
int main(void){R a={2,0,"ab",0,0},b={3,0,"cde",0,0},c={5,2,0,&a,&b};R*root=&c;printf("%c%c\n",at(root,1),at(root,3));return 0;}
