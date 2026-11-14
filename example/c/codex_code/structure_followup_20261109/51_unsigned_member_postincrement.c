#include <stdio.h>
#include <limits.h>
typedef struct Counters{unsigned int count;}Counters;
Counters state={UINT_MAX-1U};
int main(void){unsigned int first=state.count++;unsigned int second=state.count++;printf("%u %u %u\n",first,second,state.count);return 0;}
