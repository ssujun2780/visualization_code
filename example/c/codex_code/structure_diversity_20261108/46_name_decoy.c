#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

int main(void){int left[4]={1,2,3,0},right[4]={3,2,1,0},parent[4]={0,1,2,3},root=4,total=0;
 for(int i=0;i<4;i++){int node=left[i]+right[i]+parent[i];total+=node;}printf("%d\n",total+root);return 0;}
