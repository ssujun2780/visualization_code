#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
typedef struct{int X7e7913b69f[4];int X763a2e3f3c,Xe4fb0228d5,X40e4780792;int*X32ce9d3a9c,*X24aeee9201;}X00c26c621d;void Xe3078463d2(X00c26c621d*X93bc798d82,int x){X93bc798d82->X7e7913b69f[X93bc798d82->X40e4780792]=x;X93bc798d82->X40e4780792=(X93bc798d82->X40e4780792+1)%4;X93bc798d82->X763a2e3f3c++;}int X4430e9e3c9(X00c26c621d*X93bc798d82){int x=X93bc798d82->X7e7913b69f[X93bc798d82->Xe4fb0228d5];X93bc798d82->Xe4fb0228d5=(X93bc798d82->Xe4fb0228d5+1)%4;X93bc798d82->X763a2e3f3c--;return x;}int main(void){X00c26c621d X93bc798d82={0};X93bc798d82.X32ce9d3a9c=X93bc798d82.X24aeee9201=X93bc798d82.X7e7913b69f;int Xf91b465914=0;for(int x=1;x<=12;x++){if(X93bc798d82.X763a2e3f3c==3)Xf91b465914+=X4430e9e3c9(&X93bc798d82);Xe3078463d2(&X93bc798d82,x);}while(X93bc798d82.X763a2e3f3c)Xf91b465914+=X4430e9e3c9(&X93bc798d82);printf("%d %d\n",Xf91b465914,X93bc798d82.X763a2e3f3c);return 0;}
