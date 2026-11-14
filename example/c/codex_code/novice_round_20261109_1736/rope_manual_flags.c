#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct R{char text[8];int leaf,cached;struct R*l,*r;}R;
void emit(R*p,char*out){if(p->leaf){strcat(out,p->text);return;}if(p->l)emit(p->l,out);if(p->r)emit(p->r,out);}
int main(void){R a[5]={0};a[0].l=a+1;a[0].r=a+2;a[2].l=a+3;a[2].r=a+4;a[1].leaf=a[3].leaf=a[4].leaf=1;strcpy(a[1].text,"HE");strcpy(a[3].text,"L");strcpy(a[4].text,"LO");for(int i=0;i<5;i++)a[i].cached=99;R*root=a;char out[32]={0};emit(root,out);printf("%s %d\n",out,root->cached);return 0;}
