#include <stdio.h>
int visits=0;
int size(void){visits++;return 3;}
int main(void){
 int n=size();
 int a[n][2];
 for(int i=0;i<n;i++){a[i][0]=i+1;a[i][1]=2*(i+1);}
 int bytes=(int)sizeof a;
 int total=0;
 for(int i=0;i<n;i++) total+=a[i][0]+a[i][1]; // @write:total
 printf("%d %d %d\n",bytes,total,visits);
 return 0;
}
