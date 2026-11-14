#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void){const char*s="4,1,4,2";char*copy=malloc(strlen(s)+1);if(!copy)return 1;strcpy(copy,s);int total=0,count=0;
 char*p=strtok(copy,",");while(p){char*piece=malloc(strlen(p)+1);if(!piece){free(copy);return 1;}strcpy(piece,p);total+=atoi(piece);count++;free(piece);p=strtok(NULL,",");}
 printf("%d %d\n",total,count);free(copy);return 0;}
