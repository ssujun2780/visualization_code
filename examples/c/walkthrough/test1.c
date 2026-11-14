/*
 * 13277 - Arithmetic-only renewal of the supplied Karatsuba implementation.
 *
 * Changed: zero/leading-zero handling, comparison, subtraction borrowing,
 * multiplication carrying, and removal of diagnostic output from stdout.
 * The original recursive structure, allocation sizes, extra copies,
 * realloc calls, and memory leaks are intentionally retained as requested.
 *
 * WARNING: This is NOT a memory-safe implementation. Existing buffer-size
 * and string-termination errors can still cause undefined behavior, crashes,
 * or incorrect output. Arithmetic tests with padded allocations do not
 * establish correctness or safety of ordinary executions.
 */

#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <math.h>

#define MAX_DIGIT 300000
#define MAX_X_DIGIT 600000
#define CI(a) (a-'0')
#define IC(a) (a+'0')
#define X(a, b) (a*b)

char* reverse(const char* s);
char* comparison(const char a[], const char b[]);
char* add_0(const char* s, int k);
char* plus(const char a[], const char b[]);
char* subtraction(const char a[], const char b[]);
char* multiplication(const char a[], const char b[]);
char* multiplication_calculation(int len, int const_num, const char longnum[]);
char* karatsuba(const char a[], const char b[]);

/* A view into the same string: normalize its numeric representation only. */
static const char* skip_leading_zeros(const char* s){
    while(s[0] == '0' && s[1] != '\0'){
        s++;
    }
    return s;
}

char* reverse(const char* reverse_arr){
    int reverse_len = strlen(reverse_arr);
    char* reverse_num = malloc(sizeof(char)*reverse_len);
    strcpy(reverse_num, reverse_arr);

    for(int i=0; i<reverse_len/2; i++){
        char reverse_temp = reverse_num[i];
        reverse_num[i] = reverse_num[reverse_len-1-i];
        reverse_num[reverse_len-1-i] = reverse_temp;
    }
    return reverse_num;
}

char* comparison(const char comparison_constnum1[], const char comparison_constnum2[]){
    comparison_constnum1 = skip_leading_zeros(comparison_constnum1);
    comparison_constnum2 = skip_leading_zeros(comparison_constnum2);

    int comparison_len1 = strlen(comparison_constnum1);
    int comparison_len2 = strlen(comparison_constnum2);
    char* comparison_num1 = malloc(sizeof(char)*comparison_len1);
    strcpy(comparison_num1, comparison_constnum1);
    char* comparison_num2 = malloc(sizeof(char)*comparison_len2);
    strcpy(comparison_num2, comparison_constnum2);

    if(comparison_len1 != comparison_len2){
        return (comparison_len1 > comparison_len2) ? comparison_num1 : comparison_num2;
    }

    for(int comparison_i=0; comparison_i<comparison_len1; comparison_i++){
        if(comparison_num1[comparison_i] != comparison_num2[comparison_i]){
            return (comparison_num1[comparison_i] > comparison_num2[comparison_i])
                ? comparison_num1 : comparison_num2;
        }
    }
    return "same";
}

char* add_0(const char add_constnum[], int const_add_0){
    char* add_num = malloc(sizeof(char)*strlen(add_constnum));
    strcpy(add_num, add_constnum);
    add_num = reverse(add_num);
    char* add_buf = calloc(const_add_0, sizeof(char));
    int add_num_len = strlen(add_num);

    memset(add_buf, '0', const_add_0);
    strcpy(add_buf + const_add_0, add_num);
    add_num = reverse(add_buf);
    return add_num;
}

char* plus(const char plus_constnum1[], const char plus_constnum2[]){
    plus_constnum1 = skip_leading_zeros(plus_constnum1);
    plus_constnum2 = skip_leading_zeros(plus_constnum2);

    int plus_len1 = strlen(plus_constnum1);
    int plus_len2 = strlen(plus_constnum2);
    char* plus_num1 = malloc(sizeof(char)*strlen(plus_constnum1));
    strcpy(plus_num1, plus_constnum1);
    char* plus_num2 = malloc(sizeof(char)*strlen(plus_constnum2));
    strcpy(plus_num2, plus_constnum2);
    int plus_max_len = (plus_len1 > plus_len2) ? plus_len1+1 : plus_len2+1;
    char* plus_result = calloc(plus_max_len+1, sizeof(char));
    int plus_temp_result = 0;
    int plus_rest = 0;

    plus_num1 = reverse(plus_num1);
    plus_num2 = reverse(plus_num2);

    for(int plus_i=0; plus_i<plus_max_len; plus_i++){
        int plus_temp_a = CI(plus_num1[plus_i]);
        int plus_temp_b = CI(plus_num2[plus_i]);

        if(plus_i<plus_len1 && plus_i<plus_len2){
            plus_temp_result = plus_temp_a+plus_temp_b+plus_rest;
            plus_result[plus_i] = IC(plus_temp_result%10);
            plus_rest = (plus_temp_result < 10) ? 0 : 1;
        }
        else if(plus_i>=plus_len1 && plus_i>=plus_len2){
            if(plus_rest>0){
                plus_result[plus_i] = '1';
                plus_result = realloc(plus_result, sizeof(char)*plus_i+2);
            }
            else{
                plus_result = realloc(plus_result, sizeof(char)*plus_i);
            }
            break;
        }
        else{
            plus_temp_result = (plus_i>=plus_len1)
                ? plus_temp_b+plus_rest : plus_temp_a+plus_rest;
            plus_result[plus_i] = IC(plus_temp_result%10);
            plus_rest = (plus_temp_result < 10) ? 0 : 1;
        }
    }
    plus_result = reverse(plus_result);
    return plus_result;
}

/* Returns the nonnegative difference; Karatsuba calls it with a >= b. */
char* subtraction(const char subtraction_constnum1[], const char subtraction_constnum2[]){
    subtraction_constnum1 = skip_leading_zeros(subtraction_constnum1);
    subtraction_constnum2 = skip_leading_zeros(subtraction_constnum2);

    int subtraction_len1 = strlen(subtraction_constnum1);
    int subtraction_len2 = strlen(subtraction_constnum2);
    char* subtraction_num1 = malloc(sizeof(char)*subtraction_len1);
    strcpy(subtraction_num1, subtraction_constnum1);
    char* subtraction_num2 = malloc(sizeof(char)*subtraction_len2);
    strcpy(subtraction_num2, subtraction_constnum2);
    subtraction_num1 = realloc(subtraction_num1, sizeof(char)*subtraction_len1+1);
    subtraction_num2 = realloc(subtraction_num2, sizeof(char)*subtraction_len2+1);

    char* subtraction_big_num = comparison(subtraction_num1, subtraction_num2);
    if(strcmp(subtraction_big_num, "same") == 0){
        char* subtraction_zero = malloc(sizeof(char)*2);
        subtraction_zero[0] = '0';
        subtraction_zero[1] = '\0';
        return subtraction_zero;
    }

    int subtraction_big_len = strlen(subtraction_big_num);
    /* comparison() returns a copy, so pointer identity cannot identify it. */
    char* subtraction_small_num = (strcmp(subtraction_big_num, subtraction_num1) == 0)
        ? subtraction_num2 : subtraction_num1;
    int subtraction_small_len = strlen(subtraction_small_num);
    char* subtraction_result = calloc(subtraction_big_len+1, sizeof(char));
    int subtraction_temp_result = 0;
    subtraction_big_num = reverse(subtraction_big_num);
    subtraction_small_num = reverse(subtraction_small_num);

    for(int subtraction_i=0; subtraction_i<subtraction_big_len; subtraction_i++){
        int subtraction_a = CI(subtraction_big_num[subtraction_i]);
        int subtraction_b = CI(subtraction_small_num[subtraction_i]);

        if(subtraction_i<subtraction_small_len){
            subtraction_temp_result = subtraction_a-subtraction_b;
            int subtraction_k = subtraction_i+1;
            if(subtraction_temp_result<0){
                subtraction_temp_result += 10;
                while(subtraction_k<subtraction_big_len && subtraction_big_num[subtraction_k]=='0'){
                    subtraction_big_num[subtraction_k] = '9';
                    subtraction_k++;
                }
                if(subtraction_k<subtraction_big_len){
                    subtraction_big_num[subtraction_k] = IC(CI(subtraction_big_num[subtraction_k])-1);
                }
            }
            subtraction_result[subtraction_i] = IC(subtraction_temp_result);
        }
        else{
            subtraction_temp_result = CI(subtraction_big_num[subtraction_i]);
            int subtraction_k = subtraction_i+1;
            if(subtraction_temp_result<0){
                subtraction_temp_result += 10;
                while(subtraction_k<subtraction_big_len && subtraction_big_num[subtraction_k]=='0'){
                    subtraction_big_num[subtraction_k] = '9';
                    subtraction_k++;
                }
                if(subtraction_k<subtraction_big_len){
                    subtraction_big_num[subtraction_k] = IC(CI(subtraction_big_num[subtraction_k])-1);
                }
            }
            subtraction_result[subtraction_i] = IC(subtraction_temp_result);
        }
    }

    subtraction_result = reverse(subtraction_result);
    int subtraction_check_zero = 0;
    for(int subtraction_j=0; subtraction_j<strlen(subtraction_result); subtraction_j++){
        if(subtraction_result[subtraction_j]=='0') subtraction_check_zero++;
        else break;
    }
    if(subtraction_check_zero == 0){
        return subtraction_result;
    }
    else{
        char* subtraction_final_result = calloc(strlen(subtraction_result)-subtraction_check_zero, sizeof(char));
        subtraction_result = reverse(subtraction_result);
        memmove(subtraction_final_result, subtraction_result,
            (strlen(subtraction_result)-subtraction_check_zero)*sizeof(char));
        subtraction_final_result = reverse(subtraction_final_result);
        return subtraction_final_result;
    }
}

char* multiplication_calculation(int mulcal_len, int const_num, const char mulcal_constlongnum[]){
    char* mulcal_longnum = malloc(sizeof(char)*strlen(mulcal_constlongnum));
    strcpy(mulcal_longnum, mulcal_constlongnum);
    if(const_num == 1){
        return mulcal_longnum;
    }

    char* mulcal_result = calloc(MAX_X_DIGIT, sizeof(char));
    mulcal_longnum = reverse(mulcal_longnum);
    int mulcal_temp_result = 0;
    int mulcal_rest = 0;
    for(int mulcal_i=0; mulcal_i<mulcal_len; mulcal_i++){
        mulcal_temp_result = CI(mulcal_longnum[mulcal_i])*const_num+mulcal_rest;
        mulcal_result[mulcal_i] = IC(mulcal_temp_result%10);
        mulcal_rest = mulcal_temp_result/10;
    }
    if(mulcal_rest>0){
        mulcal_result[mulcal_len] = IC(mulcal_rest);
    }
    mulcal_result = realloc(mulcal_result, sizeof(char)*strlen(mulcal_result));
    mulcal_result = reverse(mulcal_result);
    return mulcal_result;
}

char* karatsuba(const char kara_num1[], const char kara_num2[]){
    int kara_len1 = strlen(kara_num1);
    int kara_len2 = strlen(kara_num2);
    char* result = malloc(sizeof(char)*MAX_X_DIGIT);
    int m = (kara_len1 < kara_len2) ? kara_len1/2 : kara_len2/2;

    kara_num1 = reverse(kara_num1);
    kara_num2 = reverse(kara_num2);
    char* x0 = malloc(sizeof(char)*m+1);
    strncpy(x0, kara_num1, m);
    x0[m] = '\0';
    char* x1 = malloc(sizeof(char)*(kara_len1-m));
    strcpy(x1, kara_num1+m);
    char* y0 = malloc(sizeof(char)*m+1);
    strncpy(y0, kara_num2, m);
    y0[m] = '\0';
    char* y1 = malloc(sizeof(char)*(kara_len2-m));
    strcpy(y1, kara_num2+m);
    x0 = reverse(x0);
    x1 = reverse(x1);
    y0 = reverse(y0);
    y1 = reverse(y1);

    char* z0 = multiplication(x0, y0);
    char* z2 = multiplication(x1, y1);
    char* x01 = plus(x1, x0);
    char* y01 = plus(y1, y0);
    char* z02 = plus(z0, z2);
    char* multiplication_x01y01 = multiplication(x01, y01);
    char* z1 = subtraction(multiplication_x01y01, z02);

    result = plus(add_0(z2, 2*m), plus(add_0(z1, m), z0));
    result = realloc(result, sizeof(char)*strlen(result));
    return result;
}

char* multiplication(const char multi_num1[], const char multi_num2[]){
    multi_num1 = skip_leading_zeros(multi_num1);
    multi_num2 = skip_leading_zeros(multi_num2);

    char* multi_result = malloc(sizeof(char)*MAX_X_DIGIT);
    int multi_len1 = strlen(multi_num1);
    int multi_len2 = strlen(multi_num2);

    if(strcmp(multi_num1, "0") == 0 || strcmp(multi_num2, "0") == 0){
        multi_result[0] = '0';
        multi_result[1] = '\0';
        return multi_result;
    }
    if(multi_len1<=4 && multi_len2<=4){
        sprintf(multi_result, "%d", atoi(multi_num1)*atoi(multi_num2));
        multi_result = realloc(multi_result, sizeof(char)*strlen(multi_result));
    }
    else if(multi_len1 == 1 || multi_len2 == 1){
        if(multi_len1 == 1){
            multi_result = multiplication_calculation(multi_len2, atoi(multi_num1), multi_num2);
            multi_result = realloc(multi_result, sizeof(char)*strlen(multi_result));
        }
        else{
            multi_result = multiplication_calculation(multi_len1, atoi(multi_num2), multi_num1);
            multi_result = realloc(multi_result, sizeof(char)*strlen(multi_result));
        }
    }
    else{
        multi_result = karatsuba(multi_num1, multi_num2);
        multi_result = realloc(multi_result, sizeof(char)*strlen(multi_result));
    }
    return multi_result;
}

int main(){
    char* num1 = malloc(sizeof(char)*MAX_DIGIT);
    char* num2 = malloc(sizeof(char)*MAX_DIGIT);
    scanf("%s", num1);
    scanf("%s", num2);
    num1 = realloc(num1, sizeof(char)*strlen(num1)+1);
    num2 = realloc(num2, sizeof(char)*strlen(num2)+1);
    num1[strlen(num1)] = '\0';
    num2[strlen(num2)] = '\0';

    char* answer = multiplication(num1, num2);
    puts(answer);

    free(num1);
    free(num2);
    free(answer);
    return 0;
}
