#include <stdio.h>

int walk(int a[][5],int p){return p<0?0:a[p][3]+walk(a,a[p][1])+walk(a,a[p][4]);}
int main(void){int a[7][5];for(int i=0;i<7;i++){a[i][0]=91;a[i][1]=-11;a[i][2]=i;a[i][3]=2;a[i][4]=-11;}
a[4][1]=0;a[4][4]=5;a[0][4]=2;int root=4;printf("S0 %d\n",walk(a,root));return 0;}
