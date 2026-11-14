#include <stdio.h>
#define MIX(c,u,s) (((c)+(u)) ^ ((unsigned int)(s)<<1))
int main(void){
 int count;if(scanf("%d",&count)!=1)return 1;
 unsigned int total=0;
 for(int i=0;i<count;i++){
  unsigned int input,u;int s;if(scanf("%u %u %d",&input,&u,&s)!=3)return 1;
  unsigned char c=(unsigned char)input;
  unsigned int z=(c+u)^((unsigned int)s<<1); // @write:z
  unsigned int w=(z>>3)+(unsigned int)(s/7-s%7); // @write:w
  unsigned char end=(unsigned char)(z+w); // @write:end
  unsigned long long wide=((unsigned long long)z<<33)|w; // @write:wide
  int truth=c<200&&(s>=-20||end>10); // @write:truth
  int truncated=(int)((double)c/4+(double)s/2); // @write:truncated
  if(z&8U)total+=w&255U;
  printf("%u %u %u %llu %d %d\n",z,w,(unsigned)end,wide,truth,truncated);
 }
 printf("total=%u\n",total);return 0;
}
