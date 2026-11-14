#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int row_sum(int n,int row[n]){
int scratch[n];
for(int i=0;
i<n;
i++)scratch[i]=row[i];
int total=0;
for(int i=0;
i<n;
i++)total+=scratch[i];
return total;

}

int main(void){
int n=3,a[n][n];
for(int i=0;
i<n;
i++)for(int j=0;
j<n;
j++)a[i][j]=i*n+j+1;
int total=0;
for(int i=0;
i<n;
i++)total+=row_sum(n,a[i]);
printf("%d %d\n",total,(int)(sizeof a/sizeof a[0][0]));
return 0;

}

