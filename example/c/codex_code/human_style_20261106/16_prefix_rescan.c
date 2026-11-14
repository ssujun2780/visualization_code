#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){char text[6]="abcde",prefix[6]={0},line[32];int total=0;for(int i=0;i<5;i++){memcpy(prefix,text,(size_t)i+1);prefix[i+1]=0;int n=(int)strlen(prefix);total+=n;snprintf(line,sizeof line,"%s:%d",prefix,n);puts(line);}printf("%d\n",total);return 0;}
