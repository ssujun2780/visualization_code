#include <stdio.h>
#include <stdlib.h>
#include <string.h>

char*rev(const char*s){int n=(int)strlen(s);char*r=malloc((size_t)n+1);if(!r)return NULL;strcpy(r,s);
 for(int i=0;i<(int)strlen(s)/2;i++){int j=(int)strlen(s)-1-i;char temp=r[i];r[i]=r[j];r[j]=temp;}return r;}
int main(void){char*a=rev("abcde");if(!a)return 1;char*b=rev(a);if(!b){free(a);return 1;}printf("%s %s\n",a,b);free(a);free(b);return 0;}
