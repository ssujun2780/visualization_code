#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){const char text[]="banana";char*p=malloc(1);if(!p)return 1;p[0]=0;
 for(int i=0;i<(int)strlen(text);i++){size_t n=strlen(p);char*q=realloc(p,n+2);if(!q){free(p);return 1;}p=q;char one[2]={text[i],0};strcat(p,one);}
 printf("%s %d\n",p,(int)strlen(p));free(p);return 0;}
