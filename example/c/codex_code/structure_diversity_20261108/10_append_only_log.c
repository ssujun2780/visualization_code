#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct{int a[8],n;}S;
void append(S*s,int x){s->a[s->n++]=x;}
int main(void){S s={0};append(&s,1);append(&s,2);append(&s,3);int n=0;for(int i=0;i<s.n;i++)n+=s.a[i];printf("%d\n",n);return 0;}
