#include <stdio.h>
int keys[8],aa[8],bb[8],used;
int height(int p){if(p<0)return 0;int x=height(aa[p]),y=height(bb[p]);return 1+(x>y?x:y);}
int turn_a(int p){int q=bb[p];bb[p]=aa[q];aa[q]=p;return q;}
int turn_b(int p){int q=aa[p];aa[p]=bb[q];bb[q]=p;return q;}
int put(int p,int k){if(p<0){int q=used++;keys[q]=k;aa[q]=bb[q]=-1;return q;}
if(k<keys[p])aa[p]=put(aa[p],k);else bb[p]=put(bb[p],k);
int d=height(aa[p])-height(bb[p]);
if(d>1){if(k>keys[aa[p]])aa[p]=turn_a(aa[p]);return turn_b(p);}
if(d< -1){if(k<keys[bb[p]])bb[p]=turn_b(bb[p]);return turn_a(p);}return p;}
int walk(int p){return p<0?0:1+walk(aa[p])+walk(bb[p]);}
int find(int p,int k){while(p>=0){if(k==keys[p])return 1;p=k<keys[p]?aa[p]:bb[p];}return 0;}
int main(void){int seed=-1;seed=put(seed,30);seed=put(seed,20);seed=put(seed,10);
printf("P0 %d %d %d\n",walk(seed),find(seed,10)+find(seed,30),height(seed));
seed=put(seed,25);seed=put(seed,28);printf("P1 %d %d %d\n",walk(seed),find(seed,10)+find(seed,30),height(seed));return 0;}
