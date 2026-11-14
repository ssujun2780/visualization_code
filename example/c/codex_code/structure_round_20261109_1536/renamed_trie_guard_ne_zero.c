#include <stdio.h>
#include <stdlib.h>
#include <stddef.h>
#include <string.h>

typedef struct X8c759ae85e{int X8c6a2033f5[3];int terminal;}X8c759ae85e;
X8c759ae85e X911f77ab21[12];int X137c1282b6=1;
void Xa231dc2659(const int*s,int Xcd40e4eae0){int X464fd83114=0;for(int i=0;i<Xcd40e4eae0;i++){int k=s[i];if(X911f77ab21[X464fd83114].X8c6a2033f5[k]==0){X911f77ab21[X464fd83114].X8c6a2033f5[k]=X137c1282b6++;}X464fd83114=X911f77ab21[X464fd83114].X8c6a2033f5[k];}X911f77ab21[X464fd83114].terminal++;}
int Xa946405bd3(int X464fd83114){int X98445b7d0c=X911f77ab21[X464fd83114].terminal;for(int k=0;k<3;k++){int Xfd1a991bc6=X911f77ab21[X464fd83114].X8c6a2033f5[k];if(Xfd1a991bc6!=0)X98445b7d0c+=Xa946405bd3(Xfd1a991bc6);}return X98445b7d0c;}
int main(void){int a[3]={0,1,2},b[2]={0,2},c[3]={2,1,0};Xa231dc2659(a,3);Xa231dc2659(b,2);Xa231dc2659(c,3);
 
 printf("%d %d\n",Xa946405bd3(0),X137c1282b6);return 0;}

