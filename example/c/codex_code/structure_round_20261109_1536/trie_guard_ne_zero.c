#include <stdio.h>
#include <stdlib.h>
#include <stddef.h>
#include <string.h>

typedef struct N{int child[3];int terminal;}N;
N arena[12];int used=1;
void insert(const int*s,int n){int at=0;for(int i=0;i<n;i++){int k=s[i];if(arena[at].child[k]==0){arena[at].child[k]=used++;}at=arena[at].child[k];}arena[at].terminal++;}
int visit(int at){int sum=arena[at].terminal;for(int k=0;k<3;k++){int next=arena[at].child[k];if(next!=0)sum+=visit(next);}return sum;}
int main(void){int a[3]={0,1,2},b[2]={0,2},c[3]={2,1,0};insert(a,3);insert(b,2);insert(c,3);
 
 printf("%d %d\n",visit(0),used);return 0;}

