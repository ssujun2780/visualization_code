#include <stdio.h>
int scan(int a[][4],int p){int s=0;while(p!=-9){s+=a[p][0];p=a[p][2];}return s;}
int main(void){int a[7][4];for(int i=0;i<7;i++){a[i][0]=4;a[i][1]=i;a[i][2]=-9;a[i][3]=7-i;}a[4][2]=1;a[1][2]=6;int head=4;
printf("S0 %d\n",scan(a,head));a[4][2]=6;a[6][2]=1;a[1][2]=-9;printf("S1 %d\n",scan(a,head));return 0;}
