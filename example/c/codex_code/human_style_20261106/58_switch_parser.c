#include <stdio.h>
#include <stdlib.h>
#include <string.h>

enum State{NUMBER,NEGATIVE};
int main(void){char input[]="12,-3,4;",copy[2]={0};enum State state=NUMBER;int value=0,total=0;for(int i=0;input[i];i++){copy[0]=input[i];char ch=copy[0];switch(ch){case '-':state=NEGATIVE;break;case ',':case ';':if(state==NEGATIVE)value=-value;total+=value;value=0;state=NUMBER;break;default:value=value*10+(ch-'0');break;}}printf("%d\n",total);return 0;}
