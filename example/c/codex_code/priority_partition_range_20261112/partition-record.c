#include <stdio.h>
typedef struct {int payload,p;} Cell; Cell boxes[5];
int root_of(int k){if(boxes[k].p==k)return k;return boxes[k].p=root_of(boxes[k].p);}
void link_to(int x,int y){int a=root_of(x),b=root_of(y);if(a!=b)boxes[b].p=a;}
int main(void){for(int i=0;i<5;i++){boxes[i].payload=99;boxes[i].p=i;}link_to(2,4);link_to(1,3);link_to(2,1);for(int i=0;i<5;i++)printf("%d ",root_of(i));return 0;}