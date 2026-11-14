#include <stdio.h>
int main(void){
 int a=11,b=22;
 int count=scanf("%d %d",&a,&b);
 printf("%d %d %d\n",count,a,b);
 char tail[4];int result=scanf("%3s",tail);
 if(result==1)printf("%s\n",tail);
 return 0;
}
