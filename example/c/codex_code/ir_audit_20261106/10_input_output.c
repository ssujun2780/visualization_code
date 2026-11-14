#include <stdio.h>
#include <string.h>
int main(void){
 char buffer[16];
 if(!fgets(buffer,sizeof buffer,stdin))return 1;
 int a=0,b=0,used=0;
 int count=sscanf(buffer,"%d,%d%n",&a,&b,&used);
 char out[32];int len=snprintf(out,sizeof out,"%d:%d:%d",a+b,count,used);
 fwrite(out,1,(size_t)len,stdout);putchar('\n');
 fprintf(stderr,"ok\n");return 0;
}
