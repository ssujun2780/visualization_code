#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct{int key;char label[4];} Item;
int compare(const void*a,const void*b){Item first=*(const Item*)a,second=*(const Item*)b;Item again=first;return (again.key>second.key)-(again.key<second.key);}
int main(void){Item a[4]={{4,"d"},{1,"a"},{3,"c"},{2,"b"}};qsort(a,4,sizeof *a,compare);for(int i=0;i<4;i++)printf("%d%s ",a[i].key,a[i].label);puts("");return 0;}
