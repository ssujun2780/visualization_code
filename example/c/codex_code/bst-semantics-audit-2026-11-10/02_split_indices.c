#include <stdio.h>
int val[6]={7,5,99,10,15,100};
int west[6]={-9,-9,-9,1,-9,-9};
int east[6]={-9,0,-9,4,-9,-9};
int walk(int i) { return i<0 ? 0 : 1+walk(west[i])+walk(east[i]); }
int find(int i,int k) {
    while(i>=0) { if(val[i]==k)return 1; i=k<val[i]?west[i]:east[i]; }
    return 0;
}
int main(void) {
    int root=3;
    int z=walk(root)+find(root,7)+find(root,15);
    printf("P0 %d\n",z);
    val[0]=12;
    printf("P1 %d\n",walk(root)+find(root,12));
    return 0;
}
