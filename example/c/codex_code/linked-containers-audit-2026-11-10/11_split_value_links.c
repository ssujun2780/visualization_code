#include <stdio.h>
int scan(int*v,int*n,int p){int s=0;while(p>=0){s+=v[p];p=n[p];}return s;}
int main(void){int values[8],links[8];for(int i=0;i<8;i++){values[i]=3;links[i]=-1;}links[6]=2;links[2]=5;int head=6;
printf("S0 %d\n",scan(values,links,head));links[6]=5;printf("S1 %d\n",scan(values,links,head));return 0;}
