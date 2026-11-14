#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct{int a[8],n;}S;
int main(void){S s={0};for(int x=1;x<=3;x++){for(int j=s.n;j>0;j--)s.a[j]=s.a[j-1];s.a[0]=x;s.n++;}
 int n=0;while(s.n){int x=s.a[0];for(int j=1;j<s.n;j++)s.a[j-1]=s.a[j];s.n--;n=n*10+x;}
 printf("%d\n",n);return 0;}
