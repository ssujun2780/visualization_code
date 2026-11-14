#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int value;} Node;
int main(void){Node records[5]={{3},{8},{-2},{7},{4}};int list[5]={5,1,6,-3,2},index[5]={4,2,0,3,1};Node*p[5];for(int i=0;i<5;i++)p[i]=&records[4-i];int total=0;
for(int pass=0;pass<3;pass++)for(int i=0;i<5;i++){int answer=records[i].value+list[index[i]]*2-p[i]->value;total+=answer;}printf("%d\n",total);return 0;}
