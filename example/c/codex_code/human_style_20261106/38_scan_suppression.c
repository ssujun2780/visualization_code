#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){char s[]="12 34",out[32];int a=0,b=0,n=0;sscanf(s,"%d %d%n",&a,&b,&n);int redundant=0;sscanf(s,"%*d %d",&redundant);snprintf(out,sizeof out,"%03d:%d:%d",a,b,n);printf("%s %d\n",out,redundant);return 0;}
