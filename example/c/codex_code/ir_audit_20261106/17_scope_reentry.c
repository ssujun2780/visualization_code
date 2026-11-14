#include <stdio.h>
int main(void){
 int sum=0,iteration=0;
again:
 {
  int value=iteration+2;
  sum+=value;
  iteration++;
  if(iteration<3)goto again;
 }
 {int sum=40;printf("%d ",sum);}
 printf("%d\n",sum);return 0;
}
