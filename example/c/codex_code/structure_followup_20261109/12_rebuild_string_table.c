#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
#include <stdint.h>

char*copy(const char*s){size_t n=strlen(s)+1;char*p=malloc(n);if(p)memcpy(p,s,n);return p;}
int main(void){char**items=0;size_t used=0;const char*words[3]={"alpha","b","cc"};
for(size_t i=0;i<3;i++){char**next=malloc((used+1)*sizeof *next);if(!next)return 1;for(size_t j=0;j<used;j++)next[j]=items[j];next[used]=copy(words[i]);if(!next[used])return 1;free(items);items=next;used++;}
size_t sum=0;for(size_t i=0;i<used;i++)sum+=strlen(items[i]);printf("%zu %s\n",sum,items[2]);for(size_t i=0;i<used;i++)free(items[i]);free(items);return 0;}
