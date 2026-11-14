#include <stdio.h>
#include <string.h>
int main(void){
 char s[16]="abcdef";
 char *p=s+1;
 memmove(p+1,p,6);
 s[1]='X';
 char *tail=memchr(s,'d',7);
 printf("%s %ld\n",s,(long)(tail-s));
 return 0;
}
