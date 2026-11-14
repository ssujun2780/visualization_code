#include <stdio.h>
typedef struct {int padding,value,link,key;}Piece;Piece pool[8];int heads[3]={-1,-1,-1},count,order[8];
void add(int k){int z=k%3,i=count;pool[i].padding=123;pool[i].key=k;pool[i].value=k*10;pool[i].link=heads[z];heads[z]=i;order[count]=i;count++;}
int get(int k){int p=heads[k%3];while(p!=-1){if(pool[p].key==k)return pool[p].value;p=pool[p].link;}return -1;}
int main(void){add(2);add(5);add(8);add(1);printf("A %d %d %d\n",get(5),heads[1],heads[2]);return 0;}
