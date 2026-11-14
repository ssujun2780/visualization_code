#include <stdio.h>
int twice(int x){return x*2;}
int main(void){
	/* 한글 주석: 📦 */ int value=3;
	int total=twice(value)+4;
	printf("결과=%d\n",total);
	return 0;
}
