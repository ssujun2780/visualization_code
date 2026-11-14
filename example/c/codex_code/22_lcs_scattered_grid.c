#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(void){char a[13],b[13];if(scanf("%12s%12s",a,b)!=2)return 1;int n=(int)strlen(a),m=(int)strlen(b),**table=calloc((size_t)n+1,sizeof*table);if(!table)return 1;
 for(int k=0;k<=n;k++){table[k]=calloc((size_t)m+1,sizeof**table);if(!table[k]){for(int t=0;t<k;t++)free(table[t]);free(table);return 1;}}
 int i=1,j=1,value=0;
row:
 if(i>n)goto done;
 j=1;
column:
 if(j>m){i++;goto row;}
 if(a[i-1]==b[j-1]){value=table[i-1][j-1]+1;goto store;}
 value=table[i-1][j];if(table[i][j-1]>value)value=table[i][j-1];
store:
 table[i][j]=value; /* @trace:cell */
 j++;goto column;
done:
 printf("%d\n",table[n][m]);for(int k=0;k<=n;k++)free(table[k]);free(table);return 0;}
