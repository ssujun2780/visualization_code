#include <stdio.h>
int count=0;int step(void){return ++count;}
typedef struct {int a,b;int values[3];} Packet;
int main(void){
 Packet p={.b=9,.a=step(),.values={[1]=step()}};
 printf("%d %d %d %d %d %d\n",p.a,p.b,p.values[0],p.values[1],p.values[2],count);
 return 0;
}
