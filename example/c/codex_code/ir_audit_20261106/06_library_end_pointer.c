#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void){
 char source[]="12,-7,30";char *p=source,*end;
 long sum=0;
 while(*p){long v=strtol(p,&end,10);sum+=v;if(*end==0)break;p=end+1;}
 char out[32];int length=snprintf(out,sizeof out,"sum=%ld",sum);
 char *found=strchr(out,'=');
 printf("%s %d %c\n",out,length,found[1]);return 0;
}
