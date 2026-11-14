#include <stdio.h>
static void combine(int *a, int *buffer, int left, int mid, int right) {
    int i=left, j=mid, k=left;
    while (i<mid && j<right) {
        if (a[i]<a[j]) buffer[k++]=a[i++];
        else buffer[k++]=a[j++];
    }
    while (i<mid) buffer[k++]=a[i++];
    while (j<right) buffer[k++]=a[j++];
    for (int p=left; p<right; p++) a[p]=buffer[p];
}
static void split(int *a, int *buffer, int left, int right) {
    if (right-left<2) return;
    int mid=(left+right)/2;
    split(a,buffer,left,mid);
    split(a,buffer,mid,right);
    combine(a,buffer,left,mid,right);
}
int main(void) {
    int data[6]={7,2,5,1,6,3};
    int temporary[6]={0};
    split(data,temporary,0,6);
    for (int i=0;i<6;i++) printf("%d ",data[i]);
    return 0;
}
