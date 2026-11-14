#include <stdio.h>
#include <stdlib.h>
#include <limits.h>

int n; //회의의 수
//int *ptr_n = &n; //디버그용 포인터, merge에서 마지막 디버그 출력시 for문에서 사용
int count = 1; //정답 출력

//회의 시간
typedef struct{
    int start;
    int end;
}meeting_time;

//합병정렬
void merge(meeting_time* meeting, int left, int mid, int right, meeting_time* sorted_meeting, int whatIsTime){
    //printf("MERGE\n%d %d %d, %d\n", left, mid, right, whatIsTime);
    int i = left; int j = mid+1; int k = left;
    //printf("%d: %d %d\n", k, meeting[k].start, meeting[k].end);

    while(i<=mid && j<=right){
        if(whatIsTime == 0){
            //printf("0\n");
            if(meeting[i].start < meeting[j].start){
                sorted_meeting[k].start = meeting[i].start;
                sorted_meeting[k++].end = meeting[i++].end;
                //printf("%d: %d %d\n", k, sorted_meeting[k].start, sorted_meeting[k].end);
            }
            else if(meeting[i].start == meeting[j].start){
                sorted_meeting[k].start = (meeting[i].end < meeting[j].end) ? meeting[i].start : meeting[j].start;
                sorted_meeting[k++].end = (meeting[i].end < meeting[j].end) ? meeting[i++].end : meeting[j++].end;
            }
            else{
                sorted_meeting[k].start = meeting[j].start;
                sorted_meeting[k++].end = meeting[j++].end;
                //printf("%d: %d %d\n", k, sorted_meeting[k].start, sorted_meeting[k].end);
            }
        }
        else{
            //printf("1\n");
            if(meeting[i].end < meeting[j].end){
                sorted_meeting[k].start = meeting[i].start;
                sorted_meeting[k++].end = meeting[i++].end;
                //printf("%d: %d %d\n", k, sorted_meeting[k].start, sorted_meeting[k].end);
            }
            else if(meeting[i].end == meeting[j].end){
                sorted_meeting[k].start = (meeting[i].start < meeting[j].start) ? meeting[i].start : meeting[j].start;
                sorted_meeting[k++].end = (meeting[i].start < meeting[j].start) ? meeting[i++].end : meeting[j++].end;
            }
            else{
                sorted_meeting[k].start = meeting[j].start;
                sorted_meeting[k++].end = meeting[j++].end;
                //printf("%d: %d %d\n", k, sorted_meeting[k].start, sorted_meeting[k].end);
            }
        }
    }

    if(i>mid){
        for(int l=j; l<=right; l++){ 
            sorted_meeting[k].start = meeting[l].start;
            sorted_meeting[k++].end = meeting[l].end;
        }
    }
    else{
        for(int l=i; l<=mid; l++){ 
            sorted_meeting[k].start = meeting[l].start;
            sorted_meeting[k++].end = meeting[l].end;
        }
    }

    for(int l=left; l<=right; l++){
        meeting[l].start = sorted_meeting[l].start;
        meeting[l].end = sorted_meeting[l].end;
    }

    //printf("sorted_list:\n"); for(int k=0; k<*ptr_n; k++) printf("%2d %2d\n", sorted_meeting[k].start, sorted_meeting[k].end); printf("\n");
    //printf("list       :\n"); for(int k=0; k<*ptr_n; k++) printf("%2d %2d\n", meeting[k].start, meeting[k].end); printf("\n");
}

void merge_sort(meeting_time* meeting, int left, int right, meeting_time* sorted_meeting, int whatIsTime){
    int mid;
    if(left<right){
        mid = (left+right)/2;
        //printf("1: %d %d %d\n", left, mid, right);
        merge_sort(meeting, left, mid, sorted_meeting, whatIsTime);
        //printf("2: %d %d %d\n", left, mid, right);
        merge_sort(meeting, mid+1, right, sorted_meeting, whatIsTime);
        //printf("3: %d %d %d\n", left, mid, right);
        merge(meeting, left, mid, right, sorted_meeting, whatIsTime);
    }
}

int main(){
    scanf("%d", &n);
    //meeting_time meeting[n];
    meeting_time* meeting = malloc(sizeof(meeting_time)*n); //회의 시간 저장
    meeting_time* sorted_meeting = calloc(n, sizeof(meeting_time)); //합병정렬에서 쓰일 임시 배열
    meeting_time current_meeting = {0, INT_MAX}; //지금 다룰 회의: 초기값은 제일 처음으로 끝나는 회의
    meeting_time last_meeting = {0, 0}; //종료조건 확인용 가장 늦게 시작하는 회의

    //입력
    for(int i=0; i<n; i++){
        scanf("%d %d", &meeting[i].start, &meeting[i].end);
        if(i == 0 || meeting[i].end < current_meeting.end){
            current_meeting.end = meeting[i].end;
            current_meeting.start = meeting[i].start;
        }
        else if(meeting[i].end == current_meeting.end && meeting[i].start < current_meeting.start){
            current_meeting.end = meeting[i].end;
            current_meeting.start = meeting[i].start;
        }
        if(i == 0 || meeting[i].start > last_meeting.start){
            last_meeting.start = meeting[i].start;
            last_meeting.end = meeting[i].end;
        }
    }

    printf("last_meeting: %d %d\n", last_meeting.start, last_meeting.end);

    merge_sort(meeting, 0, n-1, sorted_meeting, 1); //종료시간으로 정렬
    /*for(int i=0; i<n; i++){
        printf("%d %d\n", meeting[i].start, meeting[i].end);
    }printf("\n");*/
    int index = 1; //정렬된 첫 회의는 current_meeting으로 이미 선택됨
    
    while(current_meeting.end <= last_meeting.start){
        printf("\nBefore: current_meeting: %d %d\n", current_meeting.start, current_meeting.end);
        int found = 0; //시간이 같더라도 서로 다른 회의를 선택할 수 있음

        for(int i=index; i<n; i++){
            printf("meeting[%d]: %d %d\n", i, meeting[i].start, meeting[i].end);
            if(meeting[i].start >= current_meeting.end && meeting[i].end >= current_meeting.end ){
                printf("update!\n");
                current_meeting.start = meeting[i].start;
                current_meeting.end = meeting[i].end;
                index = i+1; count++; //선택한 회의는 다음 탐색에서 제외
                found = 1;
                break;
            }
        }

        if(!found) break;

        printf("After: current_meeting: %d %d\n", current_meeting.start, current_meeting.end);
    }

    printf("%d\n", count);

    free(meeting); free(sorted_meeting);
    return 0;
}
