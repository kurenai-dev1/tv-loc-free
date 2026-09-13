//
// FFmpeg を呼び出すラッパー（ログ出力付き）
//
//    cl /O2 /EHsc ffmpeg_wrapper.cpp
//    ffmpeg.exe -> ffmpeg_original.exe
//    ffmpeg_wrapper.exe -> ffmpeg.exe
//
#include <stdio.h>
#include <string>
#include <vector>
#include <windows.h>

// 文字列置換ヘルパー
std::string replaceAll(std::string str, const std::string& from, const std::string& to) {
    size_t start_pos = 0;
    while ((start_pos = str.find(from, start_pos)) != std::string::npos) {
        str.replace(start_pos, from.length(), to);
        start_pos += to.length();
    }
    return str;
}

// ログ出力関数 (std::cerr や << を使わずに C のファイル処理で書き出す)
void writeLog(const char* originalCmd, const char* replacedCmd, DWORD errorNumber) {
    FILE* fp = NULL;
    fopen_s(&fp, "ffmpeg_wrapper.log", "a");
    if (!fp) return;

    // 現在時刻を取得
    SYSTEMTIME st;
    GetLocalTime(&st);

    fprintf(fp, "[%04d-%02d-%02d %02d:%02d:%02d.%03d]\n",
            st.wYear, st.wMonth, st.wDay,
            st.wHour, st.wMinute, st.wSecond, st.wMilliseconds);

    if (originalCmd) {
        fprintf(fp, "  [Original] %s\n", originalCmd);
    }
    if (replacedCmd) {
        fprintf(fp, "  [Replaced] %s\n", replacedCmd);
    }
    if (errorNumber != 0) {
        fprintf(fp, "  [Error] Failed to start ffmpeg_original.exe. Code: %lu\n", errorNumber);
    }

    fprintf(fp, "--------------------------------------------------\n");
    fclose(fp);
}

int main() {
    // 1. Jellyfin が発行した全体のコマンドライン引数を取得
    std::string origCmdLine = GetCommandLineA();

    // ★ 問題のパラメータを低遅延用パラメータに置換
    std::string cmdLine = replaceAll(origCmdLine, "-probesize 1G", "-probesize 500k");
    cmdLine = replaceAll(cmdLine, "-analyzeduration 3000000", "-analyzeduration 500000");

    // 上記以外の改善点
    // 1. -re を削除（空文字に置換）
    // 前後にスペースを入れて孤立した "-re " を消す
    cmdLine = replaceAll(cmdLine, " -re ", " ");

    // 2. GOP長とセグメント長を1秒に短縮
    cmdLine = replaceAll(cmdLine, "-g:v:0 90", "-g:v:0 30");
    cmdLine = replaceAll(cmdLine, "-keyint_min:v:0 90", "-keyint_min:v:0 30");
    cmdLine = replaceAll(cmdLine, "-hls_time 3", "-hls_time 1 -hls_init_time 1");

    // 3. プリセットを最速化し、遅延ゼロモードを追加
    //  "-tune zerolatency" は、"h264_qsv"とは相容れない
    // cmdLine = replaceAll(cmdLine, "-preset veryfast", "-preset ultrafast -tune zerolatency");
    // cmdLine = replaceAll(cmdLine, "-preset veryfast", "-preset ultrafast");

    // h264_qsv を hevc_qsv (H.265) に強制置換
    // chrome や多くのブラウザは、h.265を再生できない。（特許の関係）Apple 系は可能らしい。
    // cmdLine = replaceAll(cmdLine, "-codec:v:0 h264_qsv", "-codec:v:0 hevc_qsv");

    // ログにパラメータを書き出し
    writeLog(origCmdLine.c_str(), cmdLine.c_str(), 0);

    // 3. 呼び出す本物の FFmpeg パス (同階層の ffmpeg_original.exe)
    std::string targetExe = "ffmpeg_original.exe";

    // 4. プロセス起動用の構造体準備
    STARTUPINFOA si;
    PROCESS_INFORMATION pi;
    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    ZeroMemory(&pi, sizeof(pi));

    // CreateProcess 用に書き換え可能なチャル配列を用意
    std::vector<char> cmdBuffer(cmdLine.begin(), cmdLine.end());
    cmdBuffer.push_back('\0');

    // 5. 本物の FFmpeg を起動
    BOOL result = CreateProcessA(
        targetExe.c_str(),  // アプリケーション名
        cmdBuffer.data(),   // 置換後のコマンドライン引数
        NULL, NULL, FALSE, 0, NULL, NULL,
        &si, &pi
    );

    if (!result) {
        DWORD err = GetLastError();
        writeLog(NULL, NULL, err);
        return 1;
    }

    // 6. 本物の FFmpeg が終了するまで待機し、終了コードをそのまま返す
    WaitForSingleObject(pi.hProcess, INFINITE);

    DWORD exitCode = 0;
    GetExitCodeProcess(pi.hProcess, &exitCode);

    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);

    return static_cast<int>(exitCode);
}
