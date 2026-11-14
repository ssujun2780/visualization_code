#include <stdio.h>
int main(void) {
    int input[3][4]={{1,2,3,4},{5,6,7,8},{9,10,11,12}};
    int result[3][4]={{0}};
    for (int row=1;row<2;row++) {
        for (int column=1;column<3;column++) {
            result[row][column]=input[row-1][column]+input[row][column-1]+input[row+1][column];
        }
    }
    printf("%d %d\n",result[1][1],result[1][2]);
    return 0;
}
