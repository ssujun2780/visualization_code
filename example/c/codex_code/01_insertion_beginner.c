#include <stdio.h>
int main(void){
 int n,values[32];if(scanf("%d",&n)!=1||n<1||n>32)return 1;
 for(int i=0;i<n;i++)if(scanf("%d",&values[i])!=1)return 1;
 for(int i=1;i<n;i++){
  int save=values[i],j=i;
  while(j>0&&values[j-1]>save){
   values[j]=values[j-1]; /* @trace:shift */
   j--;
  }
  values[j]=save; /* @trace:place */
 }
 for(int i=0;i<n;i++)printf("%d%c",values[i],i+1==n?'\n':' ');
 return 0;
}
