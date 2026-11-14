#include <stdio.h>
int main(void){int n,data[24],link[24],head=0;if(scanf("%d",&n)!=1||n<1||n>24)return 1;
 for(int i=0;i<n;i++){if(scanf("%d",&data[i])!=1)return 1;link[i]=i+1<n?i+1:-1;}
 int p=head,previous=-1;
 while(p!=-1){int next=link[p];link[p]=previous;previous=p;p=next;}head=previous;
 int total=0;
 for(p=head;p!=-1;p=link[p]){
  total+=data[p]; /* @trace:sum */
 }
 printf("%d\n",total);return 0;}
