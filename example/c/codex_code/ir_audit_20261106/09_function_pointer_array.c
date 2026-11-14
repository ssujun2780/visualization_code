#include <stdio.h>
int add(int a,int b){return a+b;}
int sub(int a,int b){return a-b;}
int mul(int a,int b){return a*b;}
int main(void){
 int (*ops[3])(int,int)={add,sub,mul};
 int total=0;
 for(int i=0;i<3;i++){int result=ops[i](7,i+2);total+=result;}
 printf("%d\n",total);return 0;
}
