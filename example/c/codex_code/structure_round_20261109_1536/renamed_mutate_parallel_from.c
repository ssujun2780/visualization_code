#include <stdio.h>
typedef struct{int u,v,X34d49f2f5e;} Xa6ac248ce0;
int main(void){
 int Xc5db2bc13f[3]={0,1,2},X2c62f5600b[3]={1,2,3},X3d70747f38[3]={5,2,1};
 int Xb24df35f6e[4]={0,100,100,100};
 for(int p=0;p<4;p++)for(int k=0;k<3;k++)if(Xb24df35f6e[X2c62f5600b[k]]>Xb24df35f6e[Xc5db2bc13f[k]]+X3d70747f38[k])Xb24df35f6e[X2c62f5600b[k]]=Xb24df35f6e[Xc5db2bc13f[k]]+X3d70747f38[k];
 printf("%d\n",Xb24df35f6e[0]+Xb24df35f6e[1]+Xb24df35f6e[2]+Xb24df35f6e[3]);
 Xc5db2bc13f[0]=2;
 printf("%d\n",Xb24df35f6e[0]+Xb24df35f6e[1]+Xb24df35f6e[2]+Xb24df35f6e[3]);
 for(int i=0;i<4;i++)Xb24df35f6e[i]=i?100:0;
 for(int p=0;p<4;p++)for(int k=0;k<3;k++)if(Xb24df35f6e[X2c62f5600b[k]]>Xb24df35f6e[Xc5db2bc13f[k]]+X3d70747f38[k])Xb24df35f6e[X2c62f5600b[k]]=Xb24df35f6e[Xc5db2bc13f[k]]+X3d70747f38[k];
 printf("%d\n",Xb24df35f6e[0]+Xb24df35f6e[1]+Xb24df35f6e[2]+Xb24df35f6e[3]);
 return 0;
}
