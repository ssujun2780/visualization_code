#include <stdio.h>
#include <string.h>
int main(void){
 char s[]="ab,cd,ef";
 char *first=strtok(s,",");char *second=strtok(NULL,",");char *third=strtok(NULL,",");
 printf("%s %s %s %d %d\n",first,second,third,s[2],s[5]);
 return 0;
}
