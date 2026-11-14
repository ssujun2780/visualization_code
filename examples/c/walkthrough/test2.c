#include <stdio.h>

#define MAX_COST 999

int node[5] = {1,2,3,4,5};
int cost[5][5] = {
    {0, 7, 4, 6, 1},
    {MAX_COST, 0, MAX_COST, MAX_COST, MAX_COST},
    {MAX_COST, 2, 0, 5, MAX_COST},
    {MAX_COST, 3, MAX_COST, 0, MAX_COST},
    {MAX_COST, MAX_COST, MAX_COST, 1, 0}
};


int main(){
    int length = sizeof(node)/sizeof(int);

    for(int i=0; i<length; i++){
        for(int j=0; j<length; j++){
            printf("%3d ", cost[i][j]);
        }
        printf("\n");
    }
}
