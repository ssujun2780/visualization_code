#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>
#include <stdint.h>

int main(void){int key[5]={3,1,2,1,3};char label[5]={'a','b','c','d','e'};for(int i=1;i<5;i++){int k=key[i];char v=label[i];int j=i;while(j>0&&key[j-1]>k){key[j]=key[j-1];label[j]=label[j-1];j--;}key[j]=k;label[j]=v;}for(int i=0;i<5;i++)putchar(label[i]);putchar('\n');return 0;}
